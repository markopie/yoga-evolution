import { storagePublicBase } from "../services/mediaUrl.js";

// The base URL for any remaining raw assets on GitHub (images/icons)
const BASE_RAW_URL = "https://raw.githubusercontent.com/markopie/Yoga-App-Evolution/main/";

const AUDIO_BASE = storagePublicBase('audio-assets');

/**
 * BRIDGE_SKIP_PROBABILITY
 * Probability (0.0–1.0) that bridge_stage.mp3 is skipped on any given staged pose.
 * 0.0 = bridge always plays. 1.0 = bridge never plays.
 */
const BRIDGE_SKIP_PROBABILITY = 0.5;

export {
  BASE_RAW_URL,
  AUDIO_BASE,
  BRIDGE_SKIP_PROBABILITY,
};
