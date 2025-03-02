const { expect } = require("chai");
const { ethers } = require("hardhat");
const { setupTest } = require("./base");

describe("Orderbook: Deposits and Withdrawals", function () {
  let unified, tokenA, maker;

  beforeEach(async function () {
    const setup = await setupTest();
    unified = setup.unified;
    tokenA = setup.tokenA;
    maker = setup.maker;
  });

  it("should allow deposits", async function () {
    const depositAmount = ethers.parseEther("100");
    await tokenA.connect(maker).approve(unified.target, depositAmount);
    await expect(unified.connect(maker).deposit(tokenA.target, depositAmount))
      .to.emit(unified, "Deposit")
      .withArgs(maker.address, tokenA.target, depositAmount);
    const balance = await unified.balances(maker.address, tokenA.target);
    expect(balance).to.equal(ethers.parseEther("600")); // 500 initial + 100
  });

  it("should allow withdrawals", async function () {
    const withdrawAmount = ethers.parseEther("100");
    await expect(unified.connect(maker).withdraw(tokenA.target, withdrawAmount))
      .to.emit(unified, "Withdrawal");
    const balance = await unified.balances(maker.address, tokenA.target);
    expect(balance).to.equal(ethers.parseEther("400")); // 500 - 100
  });

  it("should revert withdrawals if balance is insufficient", async function () {
    const withdrawAmount = ethers.parseEther("1000"); // more than available balance
    await expect(unified.connect(maker).withdraw(tokenA.target, withdrawAmount))
      .to.be.revertedWithCustomError(unified, "InsufficientBalance");
  });
}); 