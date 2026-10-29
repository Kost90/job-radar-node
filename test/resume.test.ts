import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { parseResume, resumeForPrompt } from '../src/resume.ts';

const example = readFileSync(new URL('../config/resume.example.json', import.meta.url), 'utf8');

it('parses the example resume and sends it minified', () => {
  const resume = parseResume(example);
  expect(resume.experience[0]?.end).toBeNull();
  const prompt = resumeForPrompt(resume);
  expect(prompt).not.toContain('\n');
  expect(prompt.length).toBeLessThan(example.length);
});

it('rejects a resume with a missing or mistyped field', () => {
  const broken = JSON.parse(example);
  broken.yearsOfExperience = '5';
  expect(() => parseResume(JSON.stringify(broken))).toThrow();
  expect(() => parseResume('{ not json')).toThrow();
});
