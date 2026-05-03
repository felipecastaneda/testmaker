'use server';

import fs from 'fs';
import path from 'path';

export type SaveMode = 'new_version' | 'append' | 'recreate';

export async function saveTest(testName: string, questions: any[], mode: SaveMode = 'new_version') {
  try {
    const dataDir = path.join(process.cwd(), 'data', 'tests');
    
    // Ensure directory exists
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // Sanitize filename
    const sanitizedName = testName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    
    // Find latest version
    let version = 1;
    let fileName = `${sanitizedName}_v${version}.json`;
    let latestVersion = 0;
    
    // Check for the highest existing version
    while (fs.existsSync(path.join(dataDir, `${sanitizedName}_v${latestVersion + 1}.json`))) {
      latestVersion++;
    }

    if (mode === 'recreate') {
      // Delete all existing versions first
      let v = 1;
      while (fs.existsSync(path.join(dataDir, `${sanitizedName}_v${v}.json`))) {
        fs.unlinkSync(path.join(dataDir, `${sanitizedName}_v${v}.json`));
        v++;
      }
      latestVersion = 0; // Reset for creation below
    }

    if (mode === 'append' && latestVersion > 0) {
      // Append to latest
      const latestPath = path.join(dataDir, `${sanitizedName}_v${latestVersion}.json`);
      const existingData = JSON.parse(fs.readFileSync(latestPath, 'utf-8'));
      
      const updatedData = {
        ...existingData,
        updatedAt: new Date().toISOString(),
        questions: [...existingData.questions, ...questions]
      };
      
      fs.writeFileSync(latestPath, JSON.stringify(updatedData, null, 2));
      return { success: true, fileName: `${sanitizedName}_v${latestVersion}.json`, version: latestVersion, mode: 'appended' };
    } else {
      // Create new version
      const nextVersion = latestVersion + 1;
      const nextFileName = `${sanitizedName}_v${nextVersion}.json`;
      const filePath = path.join(dataDir, nextFileName);
      
      const testData = {
        name: testName,
        version: nextVersion,
        generatedAt: new Date().toISOString(),
        questions: questions
      };

      fs.writeFileSync(filePath, JSON.stringify(testData, null, 2));
      return { success: true, fileName: nextFileName, version: nextVersion, mode: 'created' };
    }
  } catch (error) {
    console.error('Failed to save test:', error);
    return { success: false, error: String(error) };
  }
}
