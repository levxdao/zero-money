export default async ({ getNamedAccounts, deployments }) => {
    const { deployer } = await getNamedAccounts();
    const { deploy, execute } = deployments;

    const signer = "0xE9d4AFB6f8C9196972C6d9a74D5e54bBb7721f5B";
    const result = await deploy("ZeroMoney", {
        from: deployer,
        args: [signer],
        log: true,
    });
    if (result.newlyDeployed) {
        await execute("ZeroMoney", { from: deployer, log: true }, "setBlacklisted(address,bool)", deployer, true);
    }
};
