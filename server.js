/**
 * 🔱 APEX v38.10.4 - THE DYNAMIC WHALE STRIKE
 * Strategy: Whale Monitoring + Scaling Flash Loans
 * Target Contract: 0x83EF5c401fAa5B9674BAfAcFb089b30bAc67C9A0
 */

const { ethers, Wallet, WebSocketProvider } = require('ethers');

const CONFIG = {
    CHAIN_ID: 8453,
    MY_CONTRACT: "0x83EF5c401fAa5B9674BAfAcFb089b30bAc67C9A0",
    WETH: "0x4200000000000000000000000000000000000006",
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    
    // --- WHALE & PROFIT FILTERS ---
    WHALE_THRESHOLD: ethers.parseEther("15"), // Only trigger on txs > 15 ETH
    MIN_NET_PROFIT: "0.01", // Target ~$33 minimum take-home after ALL fees
    
    GAS_LIMIT: 980000n, 
    MAX_FEE: ethers.parseUnits("0.3", "gwei"),
    MAX_PRIORITY: ethers.parseUnits("0.2", "gwei"),
    WSS_URL: "wss://base-mainnet.g.alchemy.com/v2/G-WBAMA8JxJMjkc-BCeoK"
};

const ABI = [
    "function requestTitanLoan(address _token, uint256 _amount, address[] calldata _path)",
    "function getProfitEstimate(address _token, uint256 _amount, address[] calldata _path) external view returns (uint256)"
];

let provider, signer, titanContract, nextNonce;

async function startBot() {
    provider = new WebSocketProvider(CONFIG.WSS_URL);
    signer = new Wallet(process.env.TREASURY_PRIVATE_KEY, provider);
    titanContract = new ethers.Contract(CONFIG.MY_CONTRACT, ABI, signer);

    console.log(`\n🐋 TITAN WHALE STRIKE SYSTEM ONLINE`);
    console.log(`📡 MONITORING: Transactions > ${ethers.formatEther(CONFIG.WHALE_THRESHOLD)} ETH`);

    nextNonce = await provider.getTransactionCount(signer.address, 'latest');

    // Monitor blocks for whale activity
    provider.on("block", async (num) => {
        const startTime = Date.now();
        try {
            const block = await provider.getBlock(num, true);
            process.stdout.write(`\r📦 BLOCK: ${num} | SCANNING FOR WHALES... `);

            // Filter block for "Whale" transactions (high value transfers/swaps)
            const whaleMove = block.transactions.find(t => t.value >= CONFIG.WHALE_THRESHOLD);

            if (whaleMove) {
                console.log(`\n🚨 WHALE DETECTED: ${ethers.formatEther(whaleMove.value)} ETH Move in block ${num}`);
                executeTitanStrike(startTime);
            }
        } catch (err) {}
    });
}

/**
 * SCALING LOAN LOGIC
 */
async function getDynamicLoanAmount() {
    const balanceWei = await provider.getBalance(signer.address);
    const balanceEth = parseFloat(ethers.formatEther(balanceWei));
    const ethPrice = 3300; 
    const usdValue = balanceEth * ethPrice;

    if (usdValue >= 200) return ethers.parseEther("100");
    if (usdValue >= 100) return ethers.parseEther("75");
    if (usdValue >= 75)  return ethers.parseEther("50");
    if (usdValue >= 30)  return ethers.parseEther("25");
    return ethers.parseEther("10"); 
}

async function executeTitanStrike(startTime) {
    try {
        const loanAmount = await getDynamicLoanAmount();
        const path = [CONFIG.WETH, CONFIG.USDC];

        // 1. ADVANCED PROFITABILITY CHECK
        // We simulate the transaction to get the exact return value
        const rawOutput = await titanContract.requestTitanLoan.staticCall(
            CONFIG.WETH,
            loanAmount,
            path,
            { from: signer.address }
        );

        const feeData = await provider.getFeeData();
        const gasCost = CONFIG.GAS_LIMIT * (feeData.maxFeePerGas || CONFIG.MAX_FEE);
        const aaveFee = (loanAmount * 5n) / 10000n; // 0.05% Aave Fee
        
        const totalCost = gasCost + aaveFee;
        const netProfit = BigInt(rawOutput) - totalCost;

        // 2. EXECUTE ONLY IF PROFIT EXCEEDS YOUR BUFFER
        if (netProfit > ethers.parseEther(CONFIG.MIN_NET_PROFIT)) {
            console.log(`✅ PROFIT CONFIRMED: ${ethers.formatEther(netProfit)} ETH`);
            
            const tx = await titanContract.requestTitanLoan(
                CONFIG.WETH,
                loanAmount,
                path,
                {
                    gasLimit: CONFIG.GAS_LIMIT,
                    maxPriorityFeePerGas: CONFIG.MAX_PRIORITY,
                    maxFeePerGas: CONFIG.MAX_FEE,
                    nonce: nextNonce++
                }
            );

            console.log(`🚀 STRIKE FIRED [${ethers.formatEther(loanAmount)} ETH]: ${tx.hash.slice(0,20)}...`);
            await tx.wait();
            console.log(`💎 STRIKE SUCCESSFUL`);
        } else {
            console.log(`⏭️ SKIPPED: Profit below buffer (${ethers.formatEther(netProfit)} ETH)`);
        }
        
    } catch (e) {
        if (e.message.includes("nonce")) {
            nextNonce = await provider.getTransactionCount(signer.address, 'latest');
        }
    }
}

startBot();
