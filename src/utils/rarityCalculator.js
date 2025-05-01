import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../config/firebase';

export async function computeRarity({
  timestamp,          // JS Date of photo
  isFirstMintToday,  // boolean
  isUnique,          // boolean
  hasDailyBoost,     // boolean
}) {
  try {
    console.log('Starting rarity computation with params:', {
      timestamp,
      isFirstMintToday,
      isUnique,
      hasDailyBoost
    });

    // Base probabilities
    let pCommon    = 0.60;
    let pRare      = 0.20;
    let pEpic      = 0.15;
    let pLegendary = 0.05;

    // 1) Time-of-day boost (1–5%)
    //    Group existing cards by hour; if < X cards at this hour, boost
    const hour = timestamp.getHours();
    console.log('Checking cards for hour:', hour);
    
    const cardsRef = collection(db, 'cards');
    const hourQuery = query(cardsRef, where('hour', '==', hour));
    const hourSnap = await getDocs(hourQuery);
    const countAtHour = hourSnap.size;
    
    console.log('Found cards at this hour:', countAtHour);
    
    const timeBoost = Math.min(5, Math.max(1, 5 - countAtHour));
    console.log('Time boost calculated:', timeBoost);
    
    pRare      += timeBoost * 0.01;
    pEpic      += timeBoost * 0.005;
    pLegendary += timeBoost * 0.005;

    // 2) Daily first-mint bonus (3%)
    if (isFirstMintToday) {
      console.log('Applying first mint bonus');
      pRare      += 0.02;
      pEpic      += 0.007;
      pLegendary += 0.003;
    }

    // 3) Uniqueness bonus (title/image duplicates low)
    if (isUnique) {
      console.log('Applying uniqueness bonus');
      pRare      += 0.02;
      pEpic      += 0.01;
      pLegendary += 0.01;
    }

    // 4) Optional user-spend daily boost (+5% total)
    if (hasDailyBoost) {
      console.log('Applying daily boost');
      pRare      += 0.03;
      pEpic      += 0.015;
      pLegendary += 0.005;
    }

    // Normalize back to 1.0
    const total = pRare + pEpic + pLegendary + pCommon;
    pCommon    /= total;
    pRare      /= total;
    pEpic      /= total;
    pLegendary /= total;

    console.log('Final probabilities:', {
      common: pCommon,
      rare: pRare,
      epic: pEpic,
      legendary: pLegendary
    });

    // Roll RNG
    const roll = Math.random();
    console.log('Random roll:', roll);

    let rarity;
    if (roll < pLegendary) rarity = 'legendary';
    else if (roll < pLegendary + pEpic) rarity = 'epic';
    else if (roll < pLegendary + pEpic + pRare) rarity = 'rare';
    else rarity = 'common';

    console.log('Final rarity computed:', rarity);
    return rarity;
  } catch (error) {
    console.error('Error in computeRarity:', error);
    throw new Error(`Failed to compute rarity: ${error.message}`);
  }
} 