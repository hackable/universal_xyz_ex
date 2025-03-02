// test/Orderbook/index.test.js
// This file simply imports all the test files to run them together

describe("Orderbook Tests", function () {
  require("./deposits.test");
  require("./orderFill.test");
  require("./cancellation.test");
  require("./fuzzy.test");
}); 