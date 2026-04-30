import { describe, it, expect } from 'vitest';
import { validateManifest } from '../../src/validators/manifest-validator.js';

import personalityExample from '../../src/examples/personality-pack.json';
import skillExample from '../../src/examples/skill-pack.json';
import mcpConnectorExample from '../../src/examples/mcp-connector-pack.json';
import gooseRecipeExample from '../../src/examples/goose-recipe-pack.json';

describe('validateManifest', () => {
  describe('valid manifests', () => {
    it('validates a personality pack manifest', () => {
      const result = validateManifest(personalityExample);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('validates a skill pack manifest', () => {
      const result = validateManifest(skillExample);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('validates an MCP connector pack manifest', () => {
      const result = validateManifest(mcpConnectorExample);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('validates a goose-recipe pack manifest', () => {
      const result = validateManifest(gooseRecipeExample);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('validates a minimal manifest', () => {
      const result = validateManifest({
        name: 'minimal-pack',
        version: '0.1.0',
        type: 'skill',
        description: 'A minimal skill pack',
        author: 'test',
        license: 'MIT',
        skill: {
          tools: ['echo'],
          description: 'Echoes input',
        },
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('invalid manifests', () => {
    it('rejects manifest without required fields', () => {
      const result = validateManifest({});
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('rejects manifest with invalid name format', () => {
      const result = validateManifest({
        name: 'INVALID NAME!',
        version: '1.0.0',
        type: 'skill',
        description: 'Test',
        author: 'test',
        license: 'MIT',
        skill: { tools: ['a'], description: 'b' },
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path.includes('name'))).toBe(true);
    });

    it('rejects manifest with invalid version', () => {
      const result = validateManifest({
        name: 'test-pack',
        version: 'not-a-version',
        type: 'skill',
        description: 'Test',
        author: 'test',
        license: 'MIT',
        skill: { tools: ['a'], description: 'b' },
      });
      expect(result.valid).toBe(false);
    });

    it('rejects manifest with invalid type', () => {
      const result = validateManifest({
        name: 'test-pack',
        version: '1.0.0',
        type: 'invalid_type',
        description: 'Test',
        author: 'test',
        license: 'MIT',
      });
      expect(result.valid).toBe(false);
    });

    it('rejects personality manifest without personality config', () => {
      const result = validateManifest({
        name: 'test-pack',
        version: '1.0.0',
        type: 'personality',
        description: 'Test',
        author: 'test',
        license: 'MIT',
      });
      expect(result.valid).toBe(false);
    });

    it('rejects goose_recipe manifest without gooseRecipe config', () => {
      const result = validateManifest({
        name: 'test-pack',
        version: '1.0.0',
        type: 'goose_recipe',
        description: 'Test',
        author: 'test',
        license: 'MIT',
      });
      expect(result.valid).toBe(false);
    });

    it('rejects non-object input', () => {
      expect(validateManifest(null).valid).toBe(false);
      expect(validateManifest('string').valid).toBe(false);
      expect(validateManifest(42).valid).toBe(false);
    });
  });
});
