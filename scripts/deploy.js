// Script to deploy the Orderbook contract and test tokens
const { ethers } = require("hardhat");

async function main() {
  console.log("Starting deployment of contracts...");
  
  // Get the contract factories
  const Orderbook = await ethers.getContractFactory("Orderbook");
  const TestToken = await ethers.getContractFactory("TestToken");
  
  
  // Deploy the Orderbook contract with the prover address parameter
  console.log("Deploying Orderbook contract...");
  const OrderbookEx = await Orderbook.deploy();
  await OrderbookEx.waitForDeployment();
  const OrderbookExAddress = await OrderbookEx.getAddress();
  console.log(`Orderbook deployed to: ${OrderbookExAddress}`);
  
  // Deploy test tokens
  console.log("\nDeploying test tokens...");
  
  // uETH token - 18 decimals like Ethereum
  const uETH = await TestToken.deploy("Unified Ethereum", "uETH", 18, ethers.parseEther("1000000"));
  await uETH.waitForDeployment();
  const uETHAddress = await uETH.getAddress();
  console.log(`uETH token deployed to: ${uETHAddress}`);
  
  // uUSDC token - 6 decimals like USDC
  const uUSDC = await TestToken.deploy("Unified USDC", "uUSDC", 6, ethers.parseUnits("1000000", 6));
  await uUSDC.waitForDeployment();
  const uUSDCAddress = await uUSDC.getAddress();
  console.log(`uUSDC token deployed to: ${uUSDCAddress}`);
  
  // uDOGE token - 8 decimals
  const uDOGE = await TestToken.deploy("Unified DOGE", "uDOGE", 8, ethers.parseUnits("1000000", 8));
  await uDOGE.waitForDeployment();
  const uDOGEAddress = await uDOGE.getAddress();
  console.log(`uDOGE token deployed to: ${uDOGEAddress}`);
  
  // uBTC token - 8 decimals like Bitcoin
  const uBTC = await TestToken.deploy("Unified Bitcoin", "uBTC", 8, ethers.parseUnits("21000", 8));
  await uBTC.waitForDeployment();
  const uBTCAddress = await uBTC.getAddress();
  console.log(`uBTC token deployed to: ${uBTCAddress}`);
  
  // Get signers for minting tokens to test accounts
  const [account0, account1, account2, account3] = await ethers.getSigners();
  
  // Mint tokens for test accounts
  console.log("\nMinting tokens for test accounts...");
  
  // Mint uETH
  await uETH.transfer(account0.address, ethers.parseEther("10000"));
  await uETH.transfer(account1.address, ethers.parseEther("10000"));
  await uETH.transfer(account2.address, ethers.parseEther("10000"));
  await uETH.transfer(account3.address, ethers.parseEther("10000"));
  console.log("Minted uETH for test accounts");
  
  // Mint uUSDC
  await uUSDC.transfer(account0.address, ethers.parseUnits("10000", 6));
  await uUSDC.transfer(account1.address, ethers.parseUnits("10000", 6));
  await uUSDC.transfer(account2.address, ethers.parseUnits("10000", 6));
  await uUSDC.transfer(account3.address, ethers.parseUnits("10000", 6));
  console.log("Minted uUSDC for test accounts");
  
  // Mint uDOGE
  await uDOGE.transfer(account0.address, ethers.parseUnits("10000", 8));
  await uDOGE.transfer(account1.address, ethers.parseUnits("10000", 8));
  await uDOGE.transfer(account2.address, ethers.parseUnits("10000", 8));
  await uDOGE.transfer(account3.address, ethers.parseUnits("10000", 8));
  console.log("Minted uDOGE for test accounts");
  
  // Mint uBTC
  await uBTC.transfer(account0.address, ethers.parseUnits("1", 8));
  await uBTC.transfer(account1.address, ethers.parseUnits("1", 8));
  await uBTC.transfer(account2.address, ethers.parseUnits("1", 8));
  await uBTC.transfer(account3.address, ethers.parseUnits("1", 8));
  console.log("Minted uBTC for test accounts");
  
  // Summary of all deployments
  console.log("\nDeployment Summary:");
  console.log(`Orderbook: ${OrderbookExAddress}`);
  console.log(`uETH: ${uETHAddress}`);
  console.log(`uUSDC: ${uUSDCAddress}`);
  console.log(`uDOGE: ${uDOGEAddress}`);
  console.log(`uBTC: ${uBTCAddress}`);
  
  // For verification purposes
  console.log("\nContract verification commands:");
  console.log(`npx hardhat verify --network <network-name> ${OrderbookExAddress}`);
  console.log(`npx hardhat verify --network <network-name> ${uETHAddress} "Unified Ethereum" "uETH" 18 ${ethers.parseEther("1000000")}`);
  console.log(`npx hardhat verify --network <network-name> ${uUSDCAddress} "Unified USDC" "uUSDC" 6 ${ethers.parseUnits("1000000", 6)}`);
  console.log(`npx hardhat verify --network <network-name> ${uDOGEAddress} "Unified DOGE" "uDOGE" 8 ${ethers.parseUnits("1000000", 8)}`);
  console.log(`npx hardhat verify --network <network-name> ${uBTCAddress} "Unified Bitcoin" "uBTC" 8 ${ethers.parseUnits("21000", 8)}`);
}

// Execute the deployment
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Deployment failed:", error);
    process.exit(1);
  }); 