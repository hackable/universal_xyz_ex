const { expect } = require("chai");
const { ethers } = require("hardhat");

// Common setup function that can be used by all test files
async function setupTest() {
  const [prover, buyer, seller, maker, taker, other] = await ethers.getSigners();

  // Deploy two TestToken contracts
  const TestToken = await ethers.getContractFactory("TestToken");
  const tokenA = await TestToken.deploy("TokenA", "TKA", 18, ethers.parseEther("1000000"));
  const tokenB = await TestToken.deploy("TokenB", "TKB", 18, ethers.parseEther("1000000"));

  // Deploy the Orderbook contract with the designated prover
  const Orderbook = await ethers.getContractFactory("Orderbook");
  const unified = await Orderbook.deploy();

  const chainId = (await ethers.provider.getNetwork()).chainId;

  // Setup tokens and deposits:
  // For fillOrder tests: maker deposits tokenA and taker deposits tokenB
  await tokenA.transfer(maker.address, ethers.parseEther("1000"));
  await tokenB.transfer(taker.address, ethers.parseEther("1000"));
  await tokenA.connect(maker).approve(unified.target, ethers.parseEther("1000"));
  await tokenB.connect(taker).approve(unified.target, ethers.parseEther("1000"));
  await unified.connect(maker).deposit(tokenA.target, ethers.parseEther("500"));
  await unified.connect(taker).deposit(tokenB.target, ethers.parseEther("500"));

  // For settlement tests: buyer deposits tokenB and seller deposits tokenA
  await tokenB.transfer(buyer.address, ethers.parseEther("1000"));
  await tokenA.transfer(seller.address, ethers.parseEther("1000"));
  await tokenB.connect(buyer).approve(unified.target, ethers.parseEther("1000"));
  await tokenA.connect(seller).approve(unified.target, ethers.parseEther("1000"));
  await unified.connect(buyer).deposit(tokenB.target, ethers.parseEther("500"));
  await unified.connect(seller).deposit(tokenA.target, ethers.parseEther("500"));

  // Helper function to sign orders using EIP712
  async function signOrder(order, signer) {
    const domain = {
      name: "Orderbook",
      version: "1",
      chainId: chainId,
      verifyingContract: unified.target,
    };
    const types = {
      Order: [
        { name: "maker", type: "address" },
        { name: "taker", type: "address" },
        { name: "tokenSell", type: "address" },
        { name: "tokenBuy", type: "address" },
        { name: "amountSell", type: "uint256" },
        { name: "amountBuy", type: "uint256" },
        { name: "expiration", type: "uint256" },
        { name: "salt", type: "uint256" },
      ],
    };
    return await signer.signTypedData(domain, types, order);
  }

  return {
    unified,
    tokenA,
    tokenB,
    prover,
    buyer,
    seller,
    maker,
    taker,
    other,
    chainId,
    signOrder
  };
}

module.exports = { setupTest }; 