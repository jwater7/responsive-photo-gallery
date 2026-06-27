// vim: tabstop=2 shiftwidth=2 expandtab
"use strict";

/**
 * Curated zero-shot label vocabulary for tagging. Kept deliberately general;
 * extend or replace for a specific collection. Each label is scored against the
 * image embedding via CLIP (prompt "a photo of <label>").
 */

module.exports = [
  // people & animals
  "a person", "a group of people", "a child", "a baby", "a crowd",
  "a dog", "a cat", "a bird", "a horse", "a wild animal", "a fish",
  // nature & scenery
  "a landscape", "a mountain", "a beach", "the ocean", "a lake", "a river",
  "a forest", "a desert", "a sunset", "a sky", "clouds", "snow", "a garden",
  "flowers", "a tree", "a waterfall",
  // urban & places
  "a city", "a street", "a building", "a house", "a bridge", "a road",
  "a church", "a stadium", "a park", "a restaurant", "a market", "an airport",
  // transport
  "a car", "a bicycle", "a motorcycle", "a train", "an airplane", "a boat",
  "a bus", "a truck",
  // activities & events
  "a sports game", "baseball", "soccer", "basketball", "running", "swimming",
  "hiking", "skiing", "a concert", "a party", "a wedding", "a birthday",
  "cooking", "a meal", "a celebration",
  // food & objects
  "food", "a drink", "fruit", "a cake", "a computer", "a phone", "a book",
  "furniture", "artwork", "a sign with text", "a document", "a screenshot",
  // conditions & framing
  "a portrait", "a selfie", "a close-up", "an aerial view", "a black and white photo",
  "a night scene", "indoors", "outdoors",
];
