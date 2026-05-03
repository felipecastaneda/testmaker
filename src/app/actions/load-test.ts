'use server';

import fs from 'fs';
import path from 'path';

const dataDir = path.join(process.cwd(), 'data', 'tests');

export async function listTests() {
  try {
    if (!fs.existsSync(dataDir)) {
      return { success: true, tests: [] };
    }

    const files = fs.readdirSync(dataDir);
    const tests = files
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const filePath = path.join(dataDir, f);
        const stats = fs.statSync(filePath);
        const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        
        return {
          id: f,
          name: content.name || f.replace('.json', ''),
          version: content.version || 1,
          createdAt: content.generatedAt || stats.birthtime.toISOString(),
          questionCount: content.questions?.length || 0
        };
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return { success: true, tests };
  } catch (error) {
    console.error('Failed to list tests:', error);
    return { success: false, error: String(error) };
  }
}

export async function loadTest(fileName: string) {
  try {
    const filePath = path.join(dataDir, fileName);
    if (!fs.existsSync(filePath)) {
      throw new Error("File not found");
    }

    const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return { success: true, test: content };
  } catch (error) {
    console.error('Failed to load test:', error);
    return { success: false, error: String(error) };
  }
}
