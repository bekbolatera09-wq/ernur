"use strict";

const crypto = require("node:crypto");
const sourceQuestions = require("./questions.json");

const REQUIRED_QUESTION_COUNT = 150;
const DIFFICULTIES = new Set(["easy", "medium", "hard"]);
const FORBIDDEN_ERA = /палеолит|мезолит|неолит|энеолит|қола\s+дәуір/iu;

function normalizeText(value) {
  return value
    .toLocaleLowerCase("kk")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function editSimilarity(left, right) {
  if (!left || !right) return 0;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return 1 - previous[right.length] / Math.max(left.length, right.length);
}

function bigramSimilarity(left, right) {
  const bigrams = (value) => {
    const words = value.split(" ");
    return new Set(words.slice(0, -1).map((word, index) => `${word} ${words[index + 1]}`));
  };
  const leftBigrams = bigrams(left);
  const rightBigrams = bigrams(right);
  if (!leftBigrams.size || !rightBigrams.size) return left === right ? 1 : 0;
  let overlap = 0;
  for (const bigram of leftBigrams) if (rightBigrams.has(bigram)) overlap += 1;
  return (2 * overlap) / (leftBigrams.size + rightBigrams.size);
}

function isSimilarQuestion(left, right) {
  const normalizedLeft = normalizeText(left);
  const normalizedRight = normalizeText(right);
  return normalizedLeft === normalizedRight ||
    editSimilarity(normalizedLeft, normalizedRight) >= 0.92 ||
    bigramSimilarity(normalizedLeft, normalizedRight) >= 0.9;
}

function validateAndDeduplicate(questions) {
  if (!Array.isArray(questions)) throw new Error("questions.json must contain an array.");
  const unique = [];
  const ids = new Set();
  for (const question of questions) {
    if (!question || typeof question !== "object" ||
        typeof question.id !== "string" || !question.id.trim() ||
        typeof question.topic !== "string" || !question.topic.trim() ||
        typeof question.question !== "string" || !question.question.trim() ||
        !DIFFICULTIES.has(question.difficulty) ||
        !Array.isArray(question.options) || question.options.length !== 4 ||
        question.options.some((option) => typeof option !== "string" || !option.trim()) ||
        new Set(question.options.map(normalizeText)).size !== 4 ||
        !Number.isInteger(question.correctIndex) || question.correctIndex < 0 || question.correctIndex > 3) {
      throw new Error(`Invalid question-bank entry: ${question?.id || "unknown id"}.`);
    }
    if (FORBIDDEN_ERA.test(`${question.topic} ${question.question} ${question.options.join(" ")}`)) {
      throw new Error(`Question ${question.id} refers to an excluded prehistoric period.`);
    }
    if (ids.has(question.id)) continue;
    ids.add(question.id);
    if (unique.some((existing) => isSimilarQuestion(existing.question, question.question))) continue;
    unique.push(question);
  }
  if (unique.length < REQUIRED_QUESTION_COUNT) {
    throw new Error(`Question bank needs at least ${REQUIRED_QUESTION_COUNT} unique valid questions; found ${unique.length}.`);
  }
  return unique;
}

const QUESTIONS = validateAndDeduplicate(sourceQuestions);
const QUESTION_BY_ID = new Map(QUESTIONS.map((question) => [question.id, question]));

function randomIndex(maxExclusive) {
  return crypto.randomInt(maxExclusive);
}

function shuffle(values, getIndex = randomIndex) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = getIndex(index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function shuffleAnswers(question, getIndex = randomIndex) {
  const answers = shuffle(question.options.map((text, index) => ({
    text,
    correct: index === question.correctIndex
  })), getIndex);
  return {
    ...question,
    options: answers.map((answer) => answer.text),
    correctIndex: answers.findIndex((answer) => answer.correct)
  };
}

function initializeQuestionCycle(state, getIndex = randomIndex) {
  state.questionQueue = shuffle(QUESTIONS.map((question) => question.id), getIndex);
  state.usedQuestionIds = [];
  state.lastQuestionId = null;
  state.questionCycle = 1;
}

function drawQuestion(state, getIndex = randomIndex) {
  if (!Array.isArray(state.questionQueue) || !Array.isArray(state.usedQuestionIds)) {
    throw new Error("Room question queue is not initialized.");
  }
  if (state.questionQueue.length === 0) {
    const previousLastId = state.lastQuestionId || state.usedQuestionIds.at(-1) || null;
    const nextCycle = shuffle(QUESTIONS.map((question) => question.id), getIndex);
    if (nextCycle.length > 1 && nextCycle[0] === previousLastId) {
      const swapIndex = 1 + getIndex(nextCycle.length - 1);
      [nextCycle[0], nextCycle[swapIndex]] = [nextCycle[swapIndex], nextCycle[0]];
    }
    state.questionQueue = nextCycle;
    state.usedQuestionIds = [];
    state.questionCycle = (state.questionCycle || 1) + 1;
  }
  const id = state.questionQueue.shift();
  const source = QUESTION_BY_ID.get(id);
  if (!source) throw new Error(`Question ${id} is missing from questions.json.`);
  state.usedQuestionIds.push(id);
  state.lastQuestionId = id;
  return shuffleAnswers(source, getIndex);
}

module.exports = {
  QUESTIONS,
  QUESTION_BY_ID,
  drawQuestion,
  initializeQuestionCycle,
  isSimilarQuestion,
  shuffle,
  shuffleAnswers,
  validateAndDeduplicate
};
