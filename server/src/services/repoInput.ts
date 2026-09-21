/**
 * Parsing and validation of repository input from clients.
 */
import { badRequest } from '../errors';

export interface ParsedRepository {
  owner: string;
  repo: string;
}

/**
 * Parse "owner/repo" into its components.
 * GitHub treats owner/repo case-insensitively, so we lower-case both.
 */
export function parseRepositoryInput(input: string): ParsedRepository {
  const trimmed = input.trim();
  if (!trimmed) {
    throw badRequest('invalid_repository', 'Repository must be in the format "owner/repo".');
  }

  const parts = trimmed.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw badRequest('invalid_repository', 'Repository must be in the format "owner/repo".');
  }

  return {
    owner: parts[0].toLowerCase(),
    repo: parts[1].toLowerCase(),
  };
}

/** Parse a positive integer from unknown input. */
export function parsePositiveInteger(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw badRequest('invalid_input', `${fieldName} must be a positive integer.`);
  }
  return value;
}