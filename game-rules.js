"use strict";

const crypto = require("node:crypto");

const BONUS_CONFIG = Object.freeze({
  weights: Object.freeze({
    double: 3,
    shield: 25,
    points: 32,
    time: 20,
    fifty: 20
  })
});

const BONUS_DECK = [
  { id: "double", icon: "⚡", title: "Қос жүріс", description: "Қосымша жүрісті қаласаңыз, келесі кезекте бір рет қолдана аласыз." },
  { id: "shield", icon: "🛡️", title: "Қорғаныс", description: "Теріс әсерге қарсы бір қорғаныс жинағы берілді." },
  { id: "points", icon: "💎", title: "+50 ұпай", description: "Ұпайыңызға бірден 50 ұпай қосылды." },
  { id: "time", icon: "⏳", title: "+30 секунд", description: "Келесі сұрақта 90 секунд беріледі." },
  { id: "fifty", icon: "🎯", title: "50/50 мүмкіндігі", description: "Келесі сұрақта екі қате жауапты алып тастай аласыз." }
];
const BONUS_BY_ID = new Map(BONUS_DECK.map((bonus) => [bonus.id, bonus]));

function pickWeightedBonus(excludedIds = [], getRoll = crypto.randomInt) {
  const excluded = new Set(excludedIds);
  const eligible = Object.entries(BONUS_CONFIG.weights)
    .filter(([id, weight]) => weight > 0 && !excluded.has(id));
  const totalWeight = eligible.reduce((sum, [, weight]) => sum + weight, 0);
  if (totalWeight <= 0) throw new Error("No weighted bonuses are available.");
  let roll = getRoll(totalWeight);
  for (const [id, weight] of eligible) {
    if (roll < weight) return BONUS_BY_ID.get(id);
    roll -= weight;
  }
  throw new Error("Weighted bonus selection exceeded its configured range.");
}

function resolveDuplicateDouble(player, bonus, getRoll = crypto.randomInt) {
  if (bonus.id !== "double" || player.extraMoves <= 0) return bonus;
  player.extraMoves = 0;
  return pickWeightedBonus(["double"], getRoll);
}

function grantBonus(player, bonus) {
  if (bonus.id === "double") player.extraMoves = 1;
  else if (bonus.id === "shield") player.shields += 1;
  else if (bonus.id === "points") player.score += 50;
  else if (bonus.id === "time") player.extraTime += 30;
  else if (bonus.id === "fifty") player.fiftyFifty += 1;
  return bonus;
}

function canRollDice(state) {
  return (state.turnRolls === 0 && !state.extraMovePending) ||
    (state.turnRolls === 1 && state.extraMovePending);
}

function canUseExtraMove(state, player) {
  return !player.finished && state.turnRolls === 1 && state.extraMoveOffer &&
    !state.extraMovePending && player.extraMoves > 0;
}

function shouldOfferExtraMove(state, player) {
  return Boolean(player?.connected && !player.finished && state.turnRolls === 1 && player.extraMoves > 0);
}

module.exports = {
  BONUS_CONFIG,
  BONUS_DECK,
  canRollDice,
  canUseExtraMove,
  grantBonus,
  pickWeightedBonus,
  resolveDuplicateDouble,
  shouldOfferExtraMove
};
