const { expect } = require("chai");
const { ethers } = require("hardhat");
const { setupTest } = require("./base");

describe("Orderbook: Order Cancellation", function () {
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

  it("should allow a maker to cancel an order", async function () {
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
    
    // Get order hash to verify cancellation
    const orderHash = await unified.getOrderHash(order);
    
    // Cancel the order
    await expect(unified.connect(maker).cancelOrder(order))
      .to.emit(unified, "OrderCancelled")
      .withArgs(orderHash, maker.address);
    
    // Verify the order is marked as cancelled
    expect(await unified.cancelledOrders(orderHash)).to.equal(true);
    
    // Attempt to fill the cancelled order should revert
    const fillAmount = ethers.parseEther("40");
    await expect(unified.connect(taker).fillOrder(order, fillAmount, signature))
      .to.be.revertedWithCustomError(unified, "OrderAlreadyCancelled");
  });

  it("should prevent non-maker from cancelling an order", async function () {
    const order = {
      maker: maker.address,
      taker: ethers.ZeroAddress,
      tokenSell: tokenA.target,
      tokenBuy: tokenB.target,
      amountSell: ethers.parseEther("100"),
      amountBuy: ethers.parseEther("200"),
      expiration: Math.floor(Date.now() / 1000) + 3600,
      salt: 2,
    };
    
    // Attempt to cancel by non-maker should revert
    await expect(unified.connect(taker).cancelOrder(order))
      .to.be.revertedWithCustomError(unified, "OnlyMakerCanCancel");
  });

  it("should allow batch cancellation of orders", async function () {
    // Create multiple orders
    const orders = [
      {
        maker: maker.address,
        taker: ethers.ZeroAddress,
        tokenSell: tokenA.target,
        tokenBuy: tokenB.target,
        amountSell: ethers.parseEther("50"),
        amountBuy: ethers.parseEther("100"),
        expiration: Math.floor(Date.now() / 1000) + 3600,
        salt: 3,
      },
      {
        maker: maker.address,
        taker: ethers.ZeroAddress,
        tokenSell: tokenA.target,
        tokenBuy: tokenB.target,
        amountSell: ethers.parseEther("75"),
        amountBuy: ethers.parseEther("150"),
        expiration: Math.floor(Date.now() / 1000) + 3600,
        salt: 4,
      },
    ];
    
    // Cancel orders in batch
    await unified.connect(maker).cancelOrdersBatch(orders);
    
    // Verify all orders are cancelled
    for (const order of orders) {
      const orderHash = await unified.getOrderHash(order);
      expect(await unified.cancelledOrders(orderHash)).to.equal(true);
    }
  });

}); 