import fs from 'fs';
import path from 'path';

export class Logger {
  private outDir: string;
  private items: string[] = [];
  constructor(outDir: string) {
    this.outDir = outDir;
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  }
  push(line: string) { this.items.push(line); }
  save(fileName: string) {
    const p = path.join(this.outDir, fileName);
    fs.writeFileSync(p, this.items.join('\n'), 'utf-8');
  }
}
