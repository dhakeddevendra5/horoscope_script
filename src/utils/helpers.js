import { ZODIAC_SIGNS } from "../config/constants.js";

function seededPick(arr, seed) {
    const s = (Math.imul(seed >>> 0, 1664525) + 1013904223) >>> 0;
    return arr[s % arr.length];
}

function makeSeed(sign, targetDate, salt = 0) {
    return (ZODIAC_SIGNS.indexOf(sign) * 7919 +
        targetDate.getDate() * 131 +
        (targetDate.getMonth() + 1) * 37 +
        (targetDate.getFullYear() % 100) * 17 +
        salt) >>> 0;
}

export { seededPick, makeSeed };
