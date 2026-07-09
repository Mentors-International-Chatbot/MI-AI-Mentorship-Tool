/**
 * Decoupled Sensing/Steering Module
 *
 * This module provides continuous dimension tracking for adaptive tutoring:
 * - senseDimensions: Fast LLM call to assess comprehension/confusion
 * - updateDimensionState: Persist state with exponential moving average
 * - getDimensionStateMap: Fetch current state for prompt assembly
 *
 * Usage in service pipeline:
 *   const priorState = await getDimensionStateMap(socio.id);
 *   const sensed = await senseDimensions({ incomingText, priorState, lessonContext });
 *   const liveState = await updateDimensionState(socio.id, sensed.dimensions);
 *   // Pass liveState to buildSystemPrompt
 */

export { senseDimensions } from './senseDimensions';
export {
  updateDimensionState,
  getDimensionStateMap,
  clearDimensionState,
} from './updateDimensionState';
export type {
  SensedDimension,
  DimensionState,
  DimensionStateMap,
  SensingResult,
} from './types';
