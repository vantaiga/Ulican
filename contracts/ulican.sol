// ulican/contracts/ulican.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;
// Logic: flash → JIT → liquidation → arb → sweep to treasury.
// See vulcan.sol for full implementation.
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
}
interface IBalancerVault {
    function flashLoan(address recipient, address[] memory tokens,
        uint256[] memory amounts, bytes memory userData) external;
}
interface ISwapRouter {
    struct ExactInputSingleParams {
        address tokenIn; address tokenOut; uint24 fee;
        address recipient; uint256 amountIn;
        uint256 amountOutMinimum; uint160 sqrtPriceLimitX96;
    }
    function exactInputSingle(ExactInputSingleParams calldata params)
        external returns (uint256 amountOut);
}

contract Vulcan {
    address public immutable owner;
    address public immutable treasury;
    address constant BALANCER = 0xBA12222222228d8Ba445958a75a0704d566BF2C8;

    modifier onlyOwner() { require(msg.sender == owner, "!owner"); _; }

    constructor(address _treasury) {
        owner    = msg.sender;
        treasury = _treasury;
    }

    // Entry: called by APEX with flash parameters
    function executeFlash(
        address[] calldata tokens,
        uint256[] calldata amounts,
        bytes calldata userData
    ) external onlyOwner {
        IBalancerVault(BALANCER).flashLoan(address(this), tokens, amounts, userData);
    }

    // Balancer callback
    function receiveFlashLoan(
        address[] memory tokens,
        uint256[] memory amounts,
        uint256[] memory feeAmounts,
        bytes memory userData
    ) external {
        require(msg.sender == BALANCER, "!balancer");
        (uint8 strategy, bytes memory data) = abi.decode(userData, (uint8, bytes));

        if (strategy == 1) _throughput(tokens, amounts, data);
        else if (strategy == 2) _arb(tokens, amounts, data);
        else if (strategy == 3) _liquidate(tokens, amounts, data);

        // Repay
        for (uint i; i < tokens.length;) {
            IERC20(tokens[i]).transfer(BALANCER, amounts[i] + feeAmounts[i]);
            unchecked { ++i; }
        }
    }

    // Throughput: deploy flash → arb across pools → capture spread
    function _throughput(address[] memory tokens, uint256[] memory amounts, bytes memory data) internal {
        (address router, address tokenOut, uint24 fee, uint256 minOut) =
            abi.decode(data, (address, address, uint24, uint256));
        IERC20(tokens[0]).approve(router, amounts[0]);
        uint256 out = ISwapRouter(router).exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn:tokens[0], tokenOut:tokenOut, fee:fee,
                recipient:address(this), amountIn:amounts[0],
                amountOutMinimum:minOut, sqrtPriceLimitX96:0
            })
        );
        require(out >= minOut, "!profit");
        _sweep(tokens[0]);
    }

    function _arb(address[] memory tokens, uint256[] memory amounts, bytes memory data) internal {
        (address router, bytes memory swapData, uint256 minOut) =
            abi.decode(data, (address, bytes, uint256));
        IERC20(tokens[0]).approve(router, amounts[0]);
        (bool ok,) = router.call(swapData);
        require(ok, "!arb");
        require(IERC20(tokens[0]).balanceOf(address(this)) >= minOut, "!min");
        _sweep(tokens[0]);
    }

    function _liquidate(address[] memory tokens, uint256[] memory amounts, bytes memory data) internal {
        (address pool, address collateral, address user, uint256 debtAmt) =
            abi.decode(data, (address, address, address, uint256));
        IERC20(tokens[0]).approve(pool, debtAmt);
        (bool ok,) = pool.call(abi.encodeWithSignature(
            "liquidationCall(address,address,address,uint256,bool)",
            collateral, tokens[0], user, debtAmt, false
        ));
        require(ok, "!liq");
        _sweep(collateral); _sweep(tokens[0]);
    }

    function _sweep(address token) internal {
        uint256 bal = IERC20(token).balanceOf(address(this));
        if (bal > 0) IERC20(token).transfer(treasury, bal);
    }

    function sweep(address[] calldata tokens) external onlyOwner {
        for (uint i; i < tokens.length;) { _sweep(tokens[i]); unchecked{++i;} }
    }

    receive() external payable {}
}
