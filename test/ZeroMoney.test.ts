import { ZeroMoney } from "../typechain";

import { ethers } from "hardhat";
import { BigNumber, Signer, utils } from "ethers";
import { expect } from "chai";

const { constants } = ethers;
const { WeiPerEther, MaxUint256, Zero, HashZero } = constants;

ethers.utils.Logger.setLogLevel(ethers.utils.Logger.levels.ERROR); // turn off warnings

const HALVING_PERIOD = 21 * 24 * 60 * 60;
const FINAL_ERA = 60;
const ONE_ZERO = WeiPerEther;
const ID_ALICE = "0x0000000000000000000000000000000000000000000000000000000000000001";
const ID_BOB = "0x0000000000000000000000000000000000000000000000000000000000000002";
const ID_CAROL = "0x0000000000000000000000000000000000000000000000000000000000000003";

const setupTest = async () => {
    const signers = await ethers.getSigners();
    const [deployer, signer, alice, bob, carol] = signers;

    const ZeroMoneyContract = await ethers.getContractFactory("ZeroMoney");
    const zero = (await ZeroMoneyContract.deploy(signer.address)) as ZeroMoney;

    return {
        deployer,
        signer,
        alice,
        bob,
        carol,
        zero,
    };
};

const sign = async (id: string, address: string, signer: Signer) => {
    const message = utils.solidityKeccak256(["bytes32", "address"], [id, address]);
    return utils.splitSignature(await signer.signMessage(utils.arrayify(message)));
};

const setEra = async era => {
    await ethers.provider.send("evm_setNextBlockTimestamp", [Math.floor(Date.now() / 1000) + HALVING_PERIOD * era]);
    await ethers.provider.send("evm_mine", []);
};

const expectToBeAlmostEqual = (actual: BigNumber, expected: BigNumber) => {
    if (expected == Zero) {
        expect(actual).to.be.equal(0);
    } else {
        expect(actual.toString()).to.be.oneOf([
            expected.toString(),
            expected.sub(1).toString(),
            expected.add(1).toString(),
        ]);
    }
};

describe("ZeroMoney", () => {
    beforeEach(async () => {
        await ethers.provider.send("hardhat_reset", []);
    });

    it("checks initial params", async () => {
        const { signer, zero } = await setupTest();

        expect(await zero.MAGNITUDE()).to.be.equal(BigNumber.from(2).pow(128));
        expect(await zero.HALVING_PERIOD()).to.be.equal(HALVING_PERIOD);
        expect(await zero.FINAL_ERA()).to.be.equal(FINAL_ERA);
        expect(await zero.callStatic.signer()).to.be.equal(signer.address);
        expect(await zero.startedAt()).to.be.equal(0);
    });

    it("should claim", async () => {
        const { signer, alice, bob, carol, zero } = await setupTest();

        const byAlice = await sign(ID_ALICE, alice.address, alice);
        await expect(zero.connect(alice).claim(ID_ALICE, byAlice.v, byAlice.r, byAlice.s)).to.be.revertedWith(
            "ZERO: UNAUTHORIZED"
        );

        expect(await zero.totalSupply()).to.be.equal(0);

        const forAlice = utils.splitSignature(await sign(ID_ALICE, alice.address, signer));
        await expect(zero.connect(alice).claim(HashZero, forAlice.v, forAlice.r, forAlice.s)).to.be.revertedWith(
            "ZERO: INVALID_ID"
        );
        await zero.connect(alice).claim(ID_ALICE, forAlice.v, forAlice.r, forAlice.s);
        expect(await zero.totalSupply()).to.be.equal(ONE_ZERO);

        await expect(zero.connect(alice).claim(ID_ALICE, forAlice.v, forAlice.r, forAlice.s)).to.be.revertedWith(
            "ZERO: CLAIMED"
        );
        await expect(zero.connect(bob).claim(ID_BOB, forAlice.v, forAlice.r, forAlice.s)).to.be.revertedWith(
            "ZERO: UNAUTHORIZED"
        );

        const forBob = utils.splitSignature(await sign(ID_BOB, bob.address, signer));
        await zero.connect(bob).claim(ID_BOB, forBob.v, forBob.r, forBob.s);
        expect(await zero.totalSupply()).to.be.equal(ONE_ZERO.mul(2));

        await zero.changeSigner(alice.address);
        expect(await zero.callStatic.signer()).to.be.equal(alice.address);

        const forCarol = utils.splitSignature(await sign(ID_CAROL, carol.address, signer));
        await expect(zero.connect(carol).claim(ID_CAROL, forCarol.v, forCarol.r, forCarol.s)).to.revertedWith(
            "ZERO: UNAUTHORIZED"
        );

        await zero.changeSigner(signer.address);
        await zero.connect(carol).claim(ID_CAROL, forCarol.v, forCarol.r, forCarol.s);
        expect(await zero.totalSupply()).to.be.equal(ONE_ZERO.mul(3));
    });

    it("should NOT distribute before starting", async () => {
        const { signer, alice, bob, zero } = await setupTest();

        expect(await zero.totalSupply()).to.be.equal(0);

        const forAlice = utils.splitSignature(await sign(ID_ALICE, alice.address, signer));
        await zero.connect(alice).claim(ID_ALICE, forAlice.v, forAlice.r, forAlice.s);
        expect(await zero.totalSupply()).to.be.equal(ONE_ZERO);

        await zero.connect(alice).transfer(bob.address, ONE_ZERO);
        expect(await zero.balanceOf(alice.address)).to.be.equal(0);
        expect(await zero.balanceOf(bob.address)).to.be.equal(ONE_ZERO);
        expect(await zero.totalSupply()).to.be.equal(ONE_ZERO);
        expect(await zero.withdrawableDividendOf(alice.address)).to.be.equal(0);
        expect(await zero.withdrawableDividendOf(bob.address)).to.be.equal(0);
    });

    it("should NOT distribute from blacklisted addresses", async () => {
        const { signer, alice, bob, zero } = await setupTest();

        expect(await zero.totalSupply()).to.be.equal(0);

        const forAlice = utils.splitSignature(await sign(ID_ALICE, alice.address, signer));
        await zero.connect(alice).claim(ID_ALICE, forAlice.v, forAlice.r, forAlice.s);
        expect(await zero.totalSupply()).to.be.equal(ONE_ZERO);

        expect(await zero.blacklisted(alice.address)).to.be.equal(false);
        await zero.setBlacklisted(alice.address, true);
        expect(await zero.blacklisted(alice.address)).to.be.equal(true);

        await zero.start();
        await zero.connect(alice).transfer(bob.address, ONE_ZERO);
        expect(await zero.withdrawableDividendOf(alice.address)).to.be.equal(0);
        expect(await zero.withdrawableDividendOf(bob.address)).to.be.equal(0);
    });

    it("should distribute & withdraw", async () => {
        const { deployer, signer, alice, bob, zero } = await setupTest();

        expect(await zero.totalSupply()).to.be.equal(0);

        const forAlice = utils.splitSignature(await sign(ID_ALICE, alice.address, signer));
        await zero.connect(alice).claim(ID_ALICE, forAlice.v, forAlice.r, forAlice.s);
        expect(await zero.totalSupply()).to.be.equal(ONE_ZERO);

        await zero.start();
        expect(await zero.balanceOf(alice.address)).to.be.equal(ONE_ZERO);
        expect(await zero.balanceOf(deployer.address)).to.be.equal(ONE_ZERO);
        expect(await zero.totalSupply()).to.be.equal(ONE_ZERO.mul(2));
        expect(await zero.withdrawableDividendOf(alice.address)).to.be.equal(0);
        expect(await zero.withdrawableDividendOf(bob.address)).to.be.equal(0);
        expect(await zero.withdrawableDividendOf(deployer.address)).to.be.equal(0);

        await expect(zero.connect(alice).withdrawDividend()).to.be.revertedWith("ZERO: ZERO_DIVIDEND");

        await zero.connect(alice).transfer(bob.address, ONE_ZERO);
        expect(await zero.balanceOf(alice.address)).to.be.equal(0);
        expect(await zero.balanceOf(bob.address)).to.be.equal(ONE_ZERO);
        expect(await zero.balanceOf(zero.address)).to.be.equal(ONE_ZERO);
        expect(await zero.totalSupply()).to.be.equal(ONE_ZERO.mul(3));
        expectToBeAlmostEqual(await zero.withdrawableDividendOf(alice.address), Zero);
        expectToBeAlmostEqual(await zero.withdrawableDividendOf(bob.address), ONE_ZERO.div(2));
        expectToBeAlmostEqual(await zero.withdrawableDividendOf(deployer.address), ONE_ZERO.div(2));

        await zero.connect(bob).withdrawDividend();
        expectToBeAlmostEqual(await zero.balanceOf(bob.address), ONE_ZERO.mul(3).div(2));
        expectToBeAlmostEqual(await zero.balanceOf(zero.address), ONE_ZERO.div(2));
        expectToBeAlmostEqual(await zero.withdrawableDividendOf(bob.address), Zero);
        expectToBeAlmostEqual(await zero.withdrawnDividendOf(bob.address), ONE_ZERO.div(2));
    });

    it("should NOT distribute after FINAL_ERA", async () => {
        const { deployer, signer, alice, bob, zero } = await setupTest();

        const forAlice = utils.splitSignature(await sign(ID_ALICE, alice.address, signer));
        await zero.connect(alice).claim(ID_ALICE, forAlice.v, forAlice.r, forAlice.s);
        expect(await zero.totalSupply()).to.be.equal(ONE_ZERO);

        expect(await zero.currentHalvingEra()).to.be.equal(MaxUint256);
        await zero.start();
        expect(await zero.currentHalvingEra()).to.be.equal(0);

        await setEra(FINAL_ERA);
        expect(await zero.currentHalvingEra()).to.be.equal(FINAL_ERA);

        await zero.connect(alice).transfer(bob.address, ONE_ZERO);
        expect(await zero.balanceOf(alice.address)).to.be.equal(0);
        expect(await zero.balanceOf(bob.address)).to.be.equal(ONE_ZERO);
        expect(await zero.withdrawableDividendOf(alice.address)).to.be.equal(0);
        expect(await zero.withdrawableDividendOf(bob.address)).to.be.equal(0);
        expect(await zero.withdrawableDividendOf(deployer.address)).to.be.equal(0);
    });

    it("should distribute & withdraw in a complex scenario", async () => {
        const { deployer, signer, alice, bob, carol, zero } = await setupTest();

        expect(await zero.totalSupply()).to.be.equal(0);

        const forAlice = utils.splitSignature(await sign(ID_ALICE, alice.address, signer));
        await zero.connect(alice).claim(ID_ALICE, forAlice.v, forAlice.r, forAlice.s);
        await zero.start();
        const forBob = utils.splitSignature(await sign(ID_BOB, bob.address, signer));
        await zero.connect(bob).claim(ID_BOB, forBob.v, forBob.r, forBob.s);
        const forCarol = utils.splitSignature(await sign(ID_CAROL, carol.address, signer));
        await zero.connect(carol).claim(ID_CAROL, forCarol.v, forCarol.r, forCarol.s);

        expect(await zero.totalSupply()).to.be.equal(ONE_ZERO.mul(4));

        await zero.connect(alice).transfer(bob.address, ONE_ZERO);
        expectToBeAlmostEqual(await zero.withdrawableDividendOf(alice.address), Zero);
        expectToBeAlmostEqual(await zero.withdrawableDividendOf(bob.address), ONE_ZERO.div(2));
        expectToBeAlmostEqual(await zero.withdrawableDividendOf(carol.address), ONE_ZERO.div(4));
        expectToBeAlmostEqual(await zero.withdrawableDividendOf(deployer.address), ONE_ZERO.div(4));

        await Promise.all(
            [bob, carol, deployer].map(async account => {
                await zero.connect(account).withdrawDividend();
                const balance = await zero.balanceOf(account.address);
                await zero.connect(account).burn(balance.sub(ONE_ZERO));
            })
        );

        await zero.connect(bob).transfer(alice.address, ONE_ZERO);
        expectToBeAlmostEqual(await zero.withdrawableDividendOf(alice.address), ONE_ZERO.div(3));
        expectToBeAlmostEqual(await zero.withdrawableDividendOf(bob.address), Zero);
        expectToBeAlmostEqual(await zero.withdrawableDividendOf(carol.address), ONE_ZERO.div(3));
        expectToBeAlmostEqual(await zero.withdrawableDividendOf(deployer.address), ONE_ZERO.div(3));

        await Promise.all(
            [alice, carol, deployer].map(async account => {
                await zero.connect(account).withdrawDividend();
                const balance = await zero.balanceOf(account.address);
                await zero.connect(account).burn(balance.sub(ONE_ZERO));
            })
        );

        await setEra(1);
        expect(await zero.currentHalvingEra()).to.be.equal(1);

        await zero.connect(alice).transfer(bob.address, ONE_ZERO);
        expectToBeAlmostEqual(await zero.withdrawableDividendOf(alice.address), Zero);
        expectToBeAlmostEqual(await zero.withdrawableDividendOf(bob.address), ONE_ZERO.div(6));
        expectToBeAlmostEqual(await zero.withdrawableDividendOf(carol.address), ONE_ZERO.div(6));
        expectToBeAlmostEqual(await zero.withdrawableDividendOf(deployer.address), ONE_ZERO.div(6));

        await Promise.all(
            [bob, carol, deployer].map(async account => {
                await zero.connect(account).withdrawDividend();
                const balance = await zero.balanceOf(account.address);
                await zero.connect(account).burn(balance.sub(ONE_ZERO));
            })
        );

        await setEra(2);
        expect(await zero.currentHalvingEra()).to.be.equal(2);

        await zero.connect(bob).transfer(alice.address, ONE_ZERO);
        expectToBeAlmostEqual(await zero.withdrawableDividendOf(alice.address), ONE_ZERO.div(12));
        expectToBeAlmostEqual(await zero.withdrawableDividendOf(bob.address), Zero);
        expectToBeAlmostEqual(await zero.withdrawableDividendOf(carol.address), ONE_ZERO.div(12));
        expectToBeAlmostEqual(await zero.withdrawableDividendOf(deployer.address), ONE_ZERO.div(12));

        await Promise.all(
            [alice, carol, deployer].map(async account => {
                await zero.connect(account).withdrawDividend();
                const balance = await zero.balanceOf(account.address);
                await zero.connect(account).burn(balance.sub(ONE_ZERO));
            })
        );

        await setEra(3);
        expect(await zero.currentHalvingEra()).to.be.equal(3);

        await zero.connect(alice).transfer(bob.address, ONE_ZERO);
        expectToBeAlmostEqual(await zero.withdrawableDividendOf(alice.address), Zero);
        expectToBeAlmostEqual(await zero.withdrawableDividendOf(bob.address), ONE_ZERO.div(24));
        expectToBeAlmostEqual(await zero.withdrawableDividendOf(carol.address), ONE_ZERO.div(24));
        expectToBeAlmostEqual(await zero.withdrawableDividendOf(deployer.address), ONE_ZERO.div(24));
    });

    it("should burn", async () => {
        const { signer, alice, zero } = await setupTest();

        const forAlice = utils.splitSignature(await sign(ID_ALICE, alice.address, signer));
        await zero.connect(alice).claim(ID_ALICE, forAlice.v, forAlice.r, forAlice.s);
        expect(await zero.balanceOf(alice.address)).to.be.equal(ONE_ZERO);

        await zero.connect(alice).burn(ONE_ZERO.div(4));
        expect(await zero.balanceOf(alice.address)).to.be.equal(ONE_ZERO.mul(3).div(4));
        await zero.connect(alice).burn(ONE_ZERO.div(2));
        expect(await zero.balanceOf(alice.address)).to.be.equal(ONE_ZERO.div(4));
    });
});
