"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { QUESTIONS, drawQuestion, initializeQuestionCycle, validateAndDeduplicate } = require("../question-bank");
const {
  BONUS_CONFIG,
  BONUS_DECK,
  canRollDice,
  canUseExtraMove,
  grantBonus,
  pickWeightedBonus,
  resolveDuplicateDouble,
  shouldOfferExtraMove
} = require("../game-rules");

test("bonus weights produce the configured 1000-roll proportions", () => {
  const counts = new Map(BONUS_DECK.map((bonus) => [bonus.id, 0]));
  for (let roll = 0; roll < 1000; roll += 1) {
    const bonus = pickWeightedBonus([], (total) => roll % total);
    counts.set(bonus.id, counts.get(bonus.id) + 1);
  }

  for (const [id, weight] of Object.entries(BONUS_CONFIG.weights)) {
    assert.equal(counts.get(id), weight * 10);
  }
});

test("a duplicate double move is cleared and replaced without another double", () => {
  const player = { extraMoves: 1 };
  const replacement = resolveDuplicateDouble(player, BONUS_DECK[0], () => 0);

  assert.equal(player.extraMoves, 0);
  assert.equal(replacement.id, "shield");
  grantBonus(player, BONUS_DECK[0]);
  assert.equal(player.extraMoves, 1);
});

test("extra move must be chosen and never grants a third roll", () => {
  const player = { connected: true, finished: false, extraMoves: 1 };
  const state = { turnRolls: 0, extraMoveOffer: false, extraMovePending: false };

  assert.equal(canRollDice(state), true);
  state.turnRolls = 1;
  assert.equal(canRollDice(state), false);
  assert.equal(shouldOfferExtraMove(state, player), true);

  state.extraMoveOffer = true;
  assert.equal(canUseExtraMove(state, player), true);
  player.extraMoves -= 1;
  state.extraMoveOffer = false;
  state.extraMovePending = true;
  assert.equal(canRollDice(state), true);
  assert.equal(canUseExtraMove(state, player), false);

  state.turnRolls = 2;
  state.extraMovePending = false;
  assert.equal(canRollDice(state), false);
  assert.equal(shouldOfferExtraMove(state, player), false);
});

test("the question bank is balanced and has at least 150 unique questions", () => {
  assert.equal(QUESTIONS.length, 165);
  const topics = new Map();
  for (const question of QUESTIONS) topics.set(question.topic, (topics.get(question.topic) || 0) + 1);
  assert.equal(topics.size, 13);
  assert.equal([...topics.values()].reduce((sum, count) => sum + count, 0), 165);
  assert.ok([...topics.values()].every((count) => count > 0 && count <= 15));
  assert.ok(QUESTIONS.every((question) =>
    question.options.length === 4 &&
    Number.isInteger(question.correctIndex) &&
    question.correctIndex >= 0 &&
    question.correctIndex < 4
  ));
});

test("each room question cycle uses every question once and avoids a boundary repeat", () => {
  const state = {};
  const fixedIndex = () => 0;
  initializeQuestionCycle(state, fixedIndex);
  const firstCycle = Array.from({ length: QUESTIONS.length }, () => drawQuestion(state, fixedIndex));

  assert.equal(new Set(firstCycle.map((question) => question.id)).size, QUESTIONS.length);
  assert.equal(state.usedQuestionIds.length, QUESTIONS.length);
  const previousLastId = firstCycle.at(-1).id;
  const nextCycleFirst = drawQuestion(state, fixedIndex);

  assert.equal(state.questionCycle, 2);
  assert.notEqual(nextCycleFirst.id, previousLastId);
  assert.deepEqual(state.usedQuestionIds, [nextCycleFirst.id]);
  assert.equal(state.questionQueue.length, QUESTIONS.length - 1);
});

test("question loading removes duplicate IDs and near-identical question text", () => {
  const first = QUESTIONS[0];
  const duplicateId = { ...first, question: `${first.question} Өзге мәтін.` };
  const duplicateText = { ...QUESTIONS[1], id: "near-duplicate", question: first.question };
  const reusedSkippedId = { ...QUESTIONS[2], id: "near-duplicate", question: "Жаңа әрі бірегей сұрақ мәтіні." };

  assert.equal(validateAndDeduplicate([...QUESTIONS, duplicateId, duplicateText, reusedSkippedId]).length, QUESTIONS.length);
});
