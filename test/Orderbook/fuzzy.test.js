const { expect } = require("chai");
const { ethers } = require("hardhat");
const { setupTest } = require("./base");

describe("UnifiedOrderBook: Fuzzy Testing", function () {
  let unified, tokenA, tokenB, maker, taker, signOrder;

  beforeEach(async function () {
    const setup = await setupTest();
    unified = setup.unified;
    tokenA = setup.tokenA;
    tokenB = setup.tokenB;
    maker = setup.maker;
    taker = setup.taker;
    signOrder = setup.signOrder;
  });

  // Helper function to generate a random order
  function generateRandomOrder(makerAddr, takerAddr = ethers.ZeroAddress) {
    // Generate random amounts between 1 and 100 ether
    const amountSell = ethers.parseEther(String(Math.floor(Math.random() * 100) + 1));
    const amountBuy = ethers.parseEther(String(Math.floor(Math.random() * 100) + 1));
    
    // Random expiration between now and 1 hour from now
    const now = Math.floor(Date.now() / 1000);
    const expiration = now + Math.floor(Math.random() * 3600);
    
    // Random salt
    const salt = Math.floor(Math.random() * 1000000);
    
    return {
      maker: makerAddr,
      taker: takerAddr,
      tokenSell: tokenA.target,
      tokenBuy: tokenB.target,
      amountSell: amountSell,
      amountBuy: amountBuy,
      expiration: expiration,
      salt: salt,
    };
  }

  it("should handle multiple random orders correctly", async function () {
    // Ensure maker and taker have sufficient balances and approvals
    await tokenA.transfer(maker.address, ethers.parseEther("1000"));
    await tokenB.transfer(taker.address, ethers.parseEther("1000"));
    await tokenA.connect(maker).approve(unified.target, ethers.parseEther("2000")); // Increase approval
    await tokenB.connect(taker).approve(unified.target, ethers.parseEther("2000")); // Increase approval
    await unified.connect(maker).deposit(tokenA.target, ethers.parseEther("1000"));
    await unified.connect(taker).deposit(tokenB.target, ethers.parseEther("1000"));
    
    // Generate 5 random orders with smaller amounts to avoid balance issues
    const numOrders = 5;
    const orders = [];
    const signatures = [];
    const fillAmounts = [];
    let totalTokenASold = ethers.parseEther("0");
    let totalTokenBReceived = ethers.parseEther("0");
    
    for (let i = 0; i < numOrders; i++) {
      // Create orders with smaller amounts (1-20 ether instead of 1-100)
      const amountSell = ethers.parseEther(String(Math.floor(Math.random() * 20) + 1));
      const amountBuy = ethers.parseEther(String(Math.floor(Math.random() * 20) + 1));
      
      const order = {
        maker: maker.address,
        taker: ethers.ZeroAddress,
        tokenSell: tokenA.target,
        tokenBuy: tokenB.target,
        amountSell: amountSell,
        amountBuy: amountBuy,
        expiration: Math.floor(Date.now() / 1000) + 3600,
        salt: Math.floor(Math.random() * 1000000),
      };
      
      orders.push(order);
      
      const signature = await signOrder(order, maker);
      signatures.push(signature);
      
      // Fill between 10% and 50% of the order to avoid running out of balance
      const fillPercent = Math.random() * 0.4 + 0.1;
      const fillAmount = order.amountSell * BigInt(Math.floor(fillPercent * 100)) / 100n;
      fillAmounts.push(fillAmount);
      
      // Calculate expected token transfers
      totalTokenASold += fillAmount;
      const proportionalBuy = (order.amountBuy * fillAmount) / order.amountSell;
      totalTokenBReceived += proportionalBuy;
    }
    
    // Fill each order individually
    for (let i = 0; i < numOrders; i++) {
      await unified.connect(taker).fillOrder(orders[i], fillAmounts[i], signatures[i]);
    }
    
    // Verify final balances
    const makerTokenABalance = await unified.balances(maker.address, tokenA.target);
    const makerTokenBBalance = await unified.balances(maker.address, tokenB.target);
    const takerTokenABalance = await unified.balances(taker.address, tokenA.target);
    const takerTokenBBalance = await unified.balances(taker.address, tokenB.target);
    
    // Maker should have lost totalTokenASold of tokenA and gained totalTokenBReceived of tokenB
    expect(makerTokenABalance).to.equal(ethers.parseEther("1500") - totalTokenASold);
    expect(makerTokenBBalance).to.equal(totalTokenBReceived);
    
    // Taker should have gained totalTokenASold of tokenA and lost totalTokenBReceived of tokenB
    expect(takerTokenABalance).to.equal(totalTokenASold);
    expect(takerTokenBBalance).to.equal(ethers.parseEther("1500") - totalTokenBReceived);
  });

  it("should handle edge cases with random orders", async function () {
    // First, transfer more tokens to taker
    await tokenB.transfer(taker.address, ethers.parseEther("1000"));
    
    // Ensure taker has enough balance for the small order with high price
    await tokenB.connect(taker).approve(unified.target, ethers.parseEther("2000"));
    await unified.connect(taker).deposit(tokenB.target, ethers.parseEther("1000"));
    
    // Test with very small and very large values
    const smallOrder = {
      maker: maker.address,
      taker: ethers.ZeroAddress,
      tokenSell: tokenA.target,
      tokenBuy: tokenB.target,
      amountSell: 1n, // 1 wei
      amountBuy: ethers.parseEther("10"), // reduced from 1000 to avoid balance issues
      expiration: Math.floor(Date.now() / 1000) + 3600,
      salt: 12345,
    };
    
    const largeOrder = {
      maker: maker.address,
      taker: ethers.ZeroAddress,
      tokenSell: tokenA.target,
      tokenBuy: tokenB.target,
      amountSell: ethers.parseEther("100"), // reduced from 1000
      amountBuy: 1n, // 1 wei (very low price)
      expiration: Math.floor(Date.now() / 1000) + 3600,
      salt: 67890,
    };
    
    const smallSig = await signOrder(smallOrder, maker);
    const largeSig = await signOrder(largeOrder, maker);
    
    // Fill the small order completely
    await unified.connect(taker).fillOrder(smallOrder, 1n, smallSig);
    
    // Fill a small part of the large order
    await unified.connect(taker).fillOrder(largeOrder, ethers.parseEther("10"), largeSig);
    
    // Verify balances were updated correctly - using native BigInt arithmetic
    expect(await unified.balances(maker.address, tokenB.target)).to.equal(ethers.parseEther("10") + 0n); // 10 ether + 0 wei
    expect(await unified.balances(taker.address, tokenA.target)).to.equal(ethers.parseEther("10") + 1n); // 10 ether + 1 wei
  });
}); 