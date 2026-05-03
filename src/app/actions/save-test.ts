'use server';

import fs from 'fs';
import path from 'path';

export async function saveTest(testName: string, questions: any[]) {
  try {
    const dataDir = path.join(process.cwd(), 'data', 'tests');
    
    // Ensure directory exists
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // Sanitize filename
    const sanitizedName = testName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    
    // Versioning: Check if file exists and increment version
    let version = 1;
    let fileName = `${sanitizedName}_v${version}.json`;
    while (fs.existsSync(path.join(dataDir, fileName))) {
      version++;
      fileName = `${sanitizedName}_v${version}.json`;
    }

    const filePath = path.join(dataDir, fileName);
    
    const testData = {
      name: testName,
      version: version,
      generatedAt: new Date().toISOString(),
      questions: questions
    };

    fs.writeFileSync(filePath, JSON.stringify(testData, null, 2));
    
    return { success: true, fileName, version };
  } catch (error) {
    console.error('Failed to save test:', error);
    return { success: false, error: String(error) };
  }
}
