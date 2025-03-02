const { expect } = require("chai");
const { ethers } = require("hardhat");
const { setupTest } = require("./base");

describe("Orderbook: Order Fill", function () {
  let unified, tokenA, tokenB, maker, taker, other, signOrder;

  beforeEach(async function () {
    const setup = await setupTest();
    unified = setup.unified;
    tokenA = setup.tokenA;
    tokenB = setup.tokenB;
    maker = setup.maker;
    taker = setup.taker;
    other = setup.other;
    signOrder = setup.signOrder;
  });

  it("should fill an order partially with fillOrder", async function () {
    // Maker creates an order: sell 100 tokenA for 200 tokenB.
    const order = {
      maker: maker.address,
      taker: ethers.ZeroAddress,
      tokenSell: tokenA.target,
      tokenBuy: tokenB.target,
      amountSell: ethers.parseEther("100"),
      amountBuy: ethers.parseEther("200"),
      expiration: Math.floor(Date.now() / 1000) + 3600,
      salt: 1,
    };
    const signature = await signOrder(order, maker);
    const fillAmount = ethers.parseEther("40");
    const proportionalBuy = ethers.parseEther("80"); // (200/100)*40

    await expect(unified.connect(taker).fillOrder(order, fillAmount, signature))
      .to.emit(unified, "OrderFilled");

    // Verify updated internal balances.
    expect(await unified.balances(maker.address, tokenA.target)).to.equal(
      ethers.parseEther("500") - fillAmount
    );
    expect(await unified.balances(maker.address, tokenB.target)).to.equal(proportionalBuy);
    expect(await unified.balances(taker.address, tokenB.target)).to.equal(
      ethers.parseEther("500") - proportionalBuy
    );
    expect(await unified.balances(taker.address, tokenA.target)).to.equal(fillAmount);
  });

  it("should fill multiple orders in a batch with fillOrdersBatch", async function () {
    // Order 1: sell 50 tokenA for 100 tokenB.
    const order1 = {
      maker: maker.address,
      taker: ethers.ZeroAddress,
      tokenSell: tokenA.target,
      tokenBuy: tokenB.target,
      amountSell: ethers.parseEther("50"),
      amountBuy: ethers.parseEther("100"),
      expiration: Math.floor(Date.now() / 1000) + 3600,
      salt: 10,
    };
    // Order 2: sell 100 tokenA for 150 tokenB.
    const order2 = {
      maker: maker.address,
      taker: ethers.ZeroAddress,
      tokenSell: tokenA.target,
      tokenBuy: tokenB.target,
      amountSell: ethers.parseEther("100"),
      amountBuy: ethers.parseEther("150"),
      expiration: Math.floor(Date.now() / 1000) + 3600,
      salt: 11,
    };
    const signature1 = await signOrder(order1, maker);
    const signature2 = await signOrder(order2, maker);

    const orders = [order1, order2];
    const amountsToFill = [ethers.parseEther("20"), ethers.parseEther("50")];
    const signatures = [signature1, signature2];

    await unified.connect(taker).fillOrdersBatch(orders, amountsToFill, signatures);

    // Maker: tokenA decreased by (20+50)=70; tokenB increased by (order1:40 + order2:75)=115.
    expect(await unified.balances(maker.address, tokenA.target)).to.equal(
      ethers.parseEther("500") - ethers.parseEther("70")
    );
    expect(await unified.balances(maker.address, tokenB.target)).to.equal(
      ethers.parseEther("115")
    );
    // Taker: tokenB decreased by 115; tokenA increased by 70.
    expect(await unified.balances(taker.address, tokenB.target)).to.equal(
      ethers.parseEther("500") - ethers.parseEther("115")
    );
    expect(await unified.balances(taker.address, tokenA.target)).to.equal(
      ethers.parseEther("70")
    );
  });

  it("should revert fillOrder if order expired", async function () {
    const order = {
      maker: maker.address,
      taker: ethers.ZeroAddress,
      tokenSell: tokenA.target,
      tokenBuy: tokenB.target,
      amountSell: ethers.parseEther("50"),
      amountBuy: ethers.parseEther("100"),
      expiration: Math.floor(Date.now() / 1000) - 10, // expired
      salt: 2,
    };
    const signature = await signOrder(order, maker);
    const fillAmount = ethers.parseEther("10");
    await expect(unified.connect(taker).fillOrder(order, fillAmount, signature))
      .to.be.revertedWithCustomError(unified, "OrderExpired");
  });

  it("should revert fillOrder if taker is not authorized", async function () {
    const order = {
      maker: maker.address,
      taker: other.address, // only 'other' can fill
      tokenSell: tokenA.target,
      tokenBuy: tokenB.target,
      amountSell: ethers.parseEther("50"),
      amountBuy: ethers.parseEther("100"),
      expiration: Math.floor(Date.now() / 1000) + 3600,
      salt: 3,
    };
    const signature = await signOrder(order, maker);
    const fillAmount = ethers.parseEther("10");
    await expect(unified.connect(taker).fillOrder(order, fillAmount, signature))
      .to.be.revertedWithCustomError(unified, "NotAuthorizedTaker");
  });

  it("should revert fillOrder if maker or taker lacks sufficient balance", async function () {
    // First withdraw all of maker's tokenA to ensure insufficient balance
    const currentBalance = await unified.balances(maker.address, tokenA.target);
    await unified.connect(maker).withdraw(tokenA.target, currentBalance);
    
    // Maker creates an order selling 100 tokenA, but has 0 deposited now
    const order = {
      maker: maker.address,
      taker: ethers.ZeroAddress,
      tokenSell: tokenA.target,
      tokenBuy: tokenB.target,
      amountSell: ethers.parseEther("100"),
      amountBuy: ethers.parseEther("200"),
      expiration: Math.floor(Date.now() / 1000) + 3600,
      salt: 4,
    };
    const signature = await signOrder(order, maker);
    const fillAmount = ethers.parseEther("50");
    
    await expect(unified.connect(taker).fillOrder(order, fillAmount, signature))
      .to.be.revertedWithCustomError(unified, "MakerInsufficientBalance");
  });
}); 