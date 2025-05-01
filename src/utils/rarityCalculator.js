import { db } from '../config/firebase';

export async function computeRarity({
  timestamp,          // JS Date of photo
  faceCount,         // integer from 0–10
  isFirstMintToday,  // boolean
  isUnique,          // boolean
  hasDailyBoost,     // boolean
}) {
  // Base probabilities
  let pCommon    = 0.60;
  let pRare      = 0.20;
  let pEpic      = 0.15;
  let pLegendary = 0.05;

  // 1) Time-of-day boost (1–5%)
  //    Group existing cards by hour; if < X cards at this hour, boost
  const hour = timestamp.getHours();
  const snap = await db.collection('cards')
    .where('hour', '==', hour).get();
  const countAtHour = snap.size;
  const timeBoost = Math.min(5, Math.max(1, 5 - countAtHour));
  pRare      += timeBoost * 0.01;
  pEpic      += timeBoost * 0.005;
  pLegendary += timeBoost * 0.005;

  // 2) Faces boost: +1% per face up to 10%
  const faceBoost = Math.min(faceCount, 10) * 0.01;
  pRare      += faceBoost * 0.5;
  pEpic      += faceBoost * 0.3;
  pLegendary += faceBoost * 0.2;

  // 3) Daily first-mint bonus (3%)
  if (isFirstMintToday) {
    pRare      += 0.02;
    pEpic      += 0.007;
    pLegendary += 0.003;
  }

  // 4) Uniqueness bonus (title/image duplicates low)
  if (isUnique) {
    pRare      += 0.02;
    pEpic      += 0.01;
    pLegendary += 0.01;
  }

  // 5) Optional user-spend daily boost (+5% total)
  if (hasDailyBoost) {
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

  // Roll RNG
  const roll = Math.random();
  if (roll < pLegendary) return 'legendary';
  if (roll < pLegendary + pEpic) return 'epic';
  if (roll < pLegendary + pEpic + pRare) return 'rare';
  return 'common';
} 