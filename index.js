const { ethers } = require('ethers');
const { Pool, Position, TickMath } = require('@uniswap/v3-sdk');
const { Token } = require('@uniswap/sdk-core');

async function main() {
  const rpcUrl = 'https://base-mainnet.g.alchemy.com/v2/PLG7HaKwMvU9g5Ajifosm'; // Your Alchemy key
  const provider = new ethers.JsonRpcProvider(rpcUrl);

  const userAddress = '0x8A9bBEbA43E3cEc41E7922E13644cE37abE63D2f';

  // Slipstream NonfungiblePositionManager
  const positionManagerAddress = '0x827922686190790b37229fd06084350E74485b72';
  const positionManagerABI = [
    'function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, int24 tickSpacing, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)'
  ];
  const positionManager = new ethers.Contract(positionManagerAddress, positionManagerABI, provider);

  // Specific CL Gauge
  const gaugeAddress = '0x6399ed6725cC163D019aA64FF55b22149D7179A8';
  const gaugeABI = [
    'function stakedLength(address depositor) view returns (uint256)',
    'function stakedByIndex(address depositor, uint256 index) view returns (uint256)',
    'function earned(address account, uint256 tokenId) view returns (uint256)'
  ];
  const gauge = new ethers.Contract(gaugeAddress, gaugeABI, provider);

  // Pool (for slot0 to get sqrtPriceX96 and current tick)
  const poolAddress = '0x4e962BB3889Bf030368F56810A9c96B83CB3E778';
  const poolABI = [
    'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, bool unlocked)'
  ];
  const pool = new ethers.Contract(poolAddress, poolABI, provider);

  // AERO token decimals for human-readable output (AERO is 18 decimals)
  const AERO_DECIMALS = 18;

  // Base chain ID for Token objects
  const CHAIN_ID = 8453;

  // Hardcode token details and fee for this specific pool (avoids extra calls)
  const token0Address = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'; // USDC
  const token1Address = '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf'; // cbBTC
  const dec0 = 6; // USDC decimals
  const dec1 = 8; // cbBTC decimals
  const sym0 = 'USDC';
  const sym1 = 'cbBTC';
  const fee = 100; // Hardcoded 0.01% for tickSpacing 100

  // Simple retry function for calls (safety net, but less needed with Alchemy)
  async function withRetry(fn, retries = 3, delay = 1000) {
    for (let i = 0; i < retries; i++) {
      try {
        return await fn();
      } catch (err) {
        if (i === retries - 1) throw err;
        await new Promise(res => setTimeout(res, delay));
      }
    }
  }

  try {
    // Get number of staked positions in this gauge for the user
    const stakedCount = await withRetry(() => gauge.stakedLength(userAddress));
    console.log(`User has ${stakedCount} staked CL positions in the gauge.`);

    // Get pool slot0 once (shared for all positions in this pool)
    const slot0 = await withRetry(() => pool.slot0());
    const sqrtPriceX96 = slot0[0];
    const currentTick = slot0[1];

    // Fetch each staked token ID and its position details
    for (let index = 0; index < stakedCount; index++) {
      const tokenId = await withRetry(() => gauge.stakedByIndex(userAddress, index));
      const position = await withRetry(() => positionManager.positions(tokenId));

      // Verify tokens match hardcoded (for safety)
      if (position[2] !== token0Address || position[3] !== token1Address) {
        console.log('Token mismatch for position; skipping human-readable calcs.');
        continue;
      }

      // Get claimable AERO emissions for this position
      const earnedRaw = await withRetry(() => gauge.earned(userAddress, tokenId));
      const earnedHuman = ethers.formatUnits(earnedRaw, AERO_DECIMALS);

      // Create Token objects
      const token0 = new Token(CHAIN_ID, position[2], dec0, sym0);
      const token1 = new Token(CHAIN_ID, position[3], dec1, sym1);

      // Create Pool object with current state (liquidity=0 is fine for price/amount calcs)
      const poolSdk = new Pool(token0, token1, fee, sqrtPriceX96.toString(), 0, Number(currentTick));

      // Create Position object
      const positionSdk = new Position({
        pool: poolSdk,
        liquidity: position[7].toString(),
        tickLower: Number(position[5]),
        tickUpper: Number(position[6])
      });

      // Compute human-readable amounts
      const amount0Human = positionSdk.amount0.toSignificant(6);
      const amount1Human = positionSdk.amount1.toSignificant(6);

      // Compute price range in USDC per cbBTC (token0 per token1)
      const sqrtLower = TickMath.getSqrtRatioAtTick(Number(position[5]));
      const dummyPoolLower = new Pool(token0, token1, fee, sqrtLower.toString(), 0, Number(position[5]));
      const maxPrice = dummyPoolLower.token1Price.toSignificant(6); // Higher USDC per cbBTC at lower tick

      const sqrtUpper = TickMath.getSqrtRatioAtTick(Number(position[6]));
      const dummyPoolUpper = new Pool(token0, token1, fee, sqrtUpper.toString(), 0, Number(position[6]));
      const minPrice = dummyPoolUpper.token1Price.toSignificant(6); // Lower USDC per cbBTC at upper tick

      console.log(`\nStaked Position Token ID: ${tokenId.toString()}`);
      console.log('Details:', {
        token0: `${sym0} (${position[2]})`,
        token1: `${sym1} (${position[3]})`,
        tickSpacing: position[4].toString(),
        tickLower: position[5].toString(),
        tickUpper: position[6].toString(),
        liquidityRaw: position[7].toString(),
        tokensOwed0: position[10].toString(),
        tokensOwed1: position[11].toString(),
      });
      console.log(`Price Range (${sym0} per ${sym1}): ${minPrice} to ${maxPrice}`);
      console.log(`Current Holdings: ${amount0Human} ${sym0}, ${amount1Human} ${sym1}`);
      console.log('Claimable AERO Emissions (raw):', earnedRaw.toString());
      console.log('Claimable AERO Emissions (human-readable):', earnedHuman);
    }
  } catch (error) {
    console.error('Error fetching staked positions:', error.message);
  }
}

main();