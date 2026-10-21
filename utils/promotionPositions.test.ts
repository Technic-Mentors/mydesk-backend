import assert from "node:assert/strict";
import { promotionPositionOptions } from "./promotionPositions";

assert.deepEqual(
  promotionPositionOptions("Junior Developer", ["Junior Developer", "Senior Developer", "Developer", "HR Executive", "Senior Developer"]),
  ["Developer", "HR Executive", "Senior Developer"]
);
assert.deepEqual(
  promotionPositionOptions("HR Executive", ["HR Executive", "Junior Developer", "HR Manager"]),
  ["HR Manager", "Junior Developer"]
);
assert.deepEqual(promotionPositionOptions("Intern", ["Intern", "Junior Developer"]), ["Junior Developer"]);
assert.deepEqual(promotionPositionOptions("HR Executive", ["Junior Developer"]), ["Junior Developer"]);

process.stdout.write("Promotion position options passed.\n");
