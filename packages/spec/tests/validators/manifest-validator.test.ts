import { describe, it, expect } from 'vitest';
import { validateManifest } from '../../src/validators/manifest-validator.js';

import personalityExample from '../../src/examples/personality-pack.json';
import skillExample from '../../src/examples/skill-pack.json';
import mcpConnectorExample from '../../src/examples/mcp-connector-pack.json';
import gooseRecipeExample from '../../src/examples/goose-recipe-pack.json';
import widgetExample from '../../src/examples/widget-pack.json';

/** Base for ad-hoc widget manifests in the tests below. */
const widgetBase = {
  name: 'demo-widget',
  version: '1.0.0',
  type: 'widget',
  description: 'Demo widget',
  author: 'test',
  license: 'MIT',
};

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

    it('validates a widget pack manifest (external entryType)', () => {
      const result = validateManifest(widgetExample);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('validates a native widget pack manifest (componentPath)', () => {
      const result = validateManifest({
        ...widgetBase,
        widget: {
          id: 'urule:dashboard-stats',
          name: 'Dashboard Stats',
          version: '1.0.0',
          description: 'In-bundle stats tile',
          author: 'urule',
          mountPoints: ['main-panel'],
          entryType: 'native',
          componentPath: 'builtin/DashboardStats',
          permissions: [],
          defaultConfig: {},
        },
      });
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

    it('rejects widget manifest without widget config', () => {
      const result = validateManifest({ ...widgetBase });
      expect(result.valid).toBe(false);
    });

    it('rejects external widget without entryUrl', () => {
      const result = validateManifest({
        ...widgetBase,
        widget: {
          id: 'vendor:no-url',
          name: 'No URL',
          version: '1.0.0',
          description: 'missing entryUrl',
          author: 'vendor',
          mountPoints: ['sidebar'],
          entryType: 'external',
          permissions: [],
          defaultConfig: {},
        },
      });
      expect(result.valid).toBe(false);
    });

    it('rejects native widget without componentPath', () => {
      const result = validateManifest({
        ...widgetBase,
        widget: {
          id: 'vendor:no-component',
          name: 'No Component',
          version: '1.0.0',
          description: 'missing componentPath',
          author: 'vendor',
          mountPoints: ['sidebar'],
          entryType: 'native',
          permissions: [],
          defaultConfig: {},
        },
      });
      expect(result.valid).toBe(false);
    });

    it('rejects widget with an unknown mountPoint', () => {
      const result = validateManifest({
        ...widgetBase,
        widget: {
          id: 'vendor:bad-mount',
          name: 'Bad Mount',
          version: '1.0.0',
          description: 'invalid mount point',
          author: 'vendor',
          mountPoints: ['not-a-real-mount'],
          entryType: 'external',
          entryUrl: 'https://vendor.example/w.html',
          permissions: [],
          defaultConfig: {},
        },
      });
      expect(result.valid).toBe(false);
    });
  });
});
