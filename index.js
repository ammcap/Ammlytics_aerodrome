const { ethers } = require('ethers');

async function main() {
  const rpcUrl = 'https://mainnet.base.org';
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

  // AERO token decimals for human-readable output (AERO is 18 decimals)
  const AERO_DECIMALS = 18;

  try {
    // Get number of staked positions in this gauge for the user
    const stakedCount = await gauge.stakedLength(userAddress);
    console.log(`User has ${stakedCount} staked CL positions in the gauge.`);

    // Fetch each staked token ID and its position details
    for (let index = 0; index < stakedCount; index++) {
      const tokenId = await gauge.stakedByIndex(userAddress, index);
      const position = await positionManager.positions(tokenId);

      // Get claimable AERO emissions for this position
      const earnedRaw = await gauge.earned(userAddress, tokenId);
      const earnedHuman = ethers.formatUnits(earnedRaw, AERO_DECIMALS);

      console.log(`\nStaked Position Token ID: ${tokenId.toString()}`);
      console.log('Details:', {
        token0: position[2],
        token1: position[3],
        tickSpacing: position[4],
        tickLower: position[5],
        tickUpper: position[6],
        liquidity: position[7].toString(),
        tokensOwed0: position[10].toString(),
        tokensOwed1: position[11].toString(),
      });
      console.log('Claimable AERO Emissions (raw):', earnedRaw.toString());
      console.log('Claimable AERO Emissions (human-readable):', earnedHuman);
    }
  } catch (error) {
    console.error('Error fetching staked positions:', error.message);
  }
}

main();