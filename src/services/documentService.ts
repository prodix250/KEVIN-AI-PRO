import { jsPDF } from "jspdf";
import "jspdf-autotable";
import mammoth from "mammoth";

export async function extractTextFromFile(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.docx')) {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer });
      return result.value || "";
    } catch (e) {
      console.warn("Failed to extract docx with mammoth:", e);
      return await file.text();
    }
  }
  
  try {
    return await file.text();
  } catch (err) {
    console.error("Failed to read file as text:", err);
    return "";
  }
}

export async function generateDocument(title: string, content: string, format: 'pdf' | 'docx' | 'txt'): Promise<string> {
  if (format === 'pdf') {
    return generatePdfBlobUrl(title, content);
  } else if (format === 'docx') {
    return generateDocxBlobUrl(title, content);
  } else {
    const cleanTxt = cleanMarkdownForTxt(content);
    const blob = new Blob([cleanTxt], { type: 'text/plain;charset=utf-8' });
    return URL.createObjectURL(blob);
  }
}

export function cleanMarkdownForTxt(text: string): string {
  if (!text) return "";
  return text
    .replace(/```[\s\S]*?```/g, (match) => {
      const raw = match.replace(/```[a-z]*\n?/g, '').replace(/```/g, '');
      return cleanCodeSnippet(raw);
    })
    .replace(/`([^`]+)`/g, '$1')
    .replace(/#{1,6}\s+/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .trim();
}

/**
 * Rigorously sanitizes text for jsPDF WinAnsi (Helvetica) rendering to eliminate corrupted characters (e.g. Ø=ÜK)
 */
export function sanitizeTextForPdf(text: string): string {
  if (!text) return "";
  return text
    .replace(/[‘’`]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/\u00A0/g, ' ')
    .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')
    .replace(/[\u2600-\u27BF\u1F300-\u1F9FF\u1F600-\u1F64F\u1F680-\u1F6FF]/g, '')
    .replace(/[^\x00-\xFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Rigorously cleans code snippets from any leaked HTML inline styles, spans, or color tags
 */
export function cleanCodeSnippet(code: string): string {
  if (!code) return "";
  return code
    .replace(/<[^>]*>/g, '')
    .replace(/style="[^"]*"/gi, '')
    .replace(/color:\s*#[a-fA-F0-9]+;?/gi, '')
    .replace(/font-weight:\s*bold;?/gi, '')
    .replace(/font-style:\s*italic;?/gi, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

export function highlightCodeToHtml(code: string): string {
  if (!code) return "";
  const lines = code.split('\n');
  
  return lines.map(line => {
    const matchSpaces = line.match(/^ */);
    const spacesCount = matchSpaces ? matchSpaces[0].length : 0;
    const spacesHtml = '&nbsp;'.repeat(spacesCount);
    const trimmed = line.trim();
    if (!trimmed) return '<br/>';

    const safeText = trimmed
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    if (safeText.startsWith('//') || safeText.startsWith('/*')) {
      return spacesHtml + `<span style="color: #6a9955; font-style: italic;">${safeText}</span>`;
    }

    let highlighted = safeText
      .replace(/(&quot;[^&]*&quot;|"[^"]*"|'[^']*')/g, '<span style="color: #ce9178;">$1</span>')
      .replace(/\b(int|double|float|char|void|return|using|namespace|if|else|for|while|include|define|class|struct|const|static|public|private|new|this|true|false)\b/g, '<span style="color: #569cd6; font-weight: bold;">$1</span>')
      .replace(/\b(cout|cin|main|endl|printf|scanf|std|string|vector|console|log)\b/g, '<span style="color: #4ec9b0;">$1</span>')
      .replace(/\b(\d+)\b/g, '<span style="color: #b5cea8;">$1</span>');

    return spacesHtml + highlighted;
  }).join('<br/>');
}

/**
 * Parses markdown text into structured elements (paragraphs, tables, code blocks)
 */
function parseMarkdownBlocks(content: string) {
  const blocks: Array<{ type: 'text' | 'code' | 'table'; content: string; language?: string; tableData?: { headers: string[]; rows: string[][] } }> = [];
  
  const lines = content.split('\n');
  let i = 0;
  let currentText: string[] = [];

  while (i < lines.length) {
    const line = lines[i];

    // Check for code block start
    if (line.trim().startsWith('```')) {
      if (currentText.length > 0) {
        blocks.push({ type: 'text', content: currentText.join('\n') });
        currentText = [];
      }
      const lang = line.trim().replace('```', '');
      let codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      const rawCode = codeLines.join('\n');
      const cleanedCode = cleanCodeSnippet(rawCode);
      blocks.push({ type: 'code', content: cleanedCode, language: lang || 'text' });
      i++;
      continue;
    }

    // Check for table start (| col | col |)
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      if (currentText.length > 0) {
        blocks.push({ type: 'text', content: currentText.join('\n') });
        currentText = [];
      }
      let tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
        tableLines.push(lines[i]);
        i++;
      }

      // Parse table lines
      if (tableLines.length >= 2) {
        const parseRow = (rowStr: string) => 
          rowStr.split('|').map(c => c.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
        
        const headers = parseRow(tableLines[0]);
        let startIndex = 1;
        if (tableLines[1].includes('---')) {
          startIndex = 2;
        }
        const rows: string[][] = [];
        for (let r = startIndex; r < tableLines.length; r++) {
          rows.push(parseRow(tableLines[r]));
        }
        blocks.push({ type: 'table', content: '', tableData: { headers, rows } });
      }
      continue;
    }

    currentText.push(line);
    i++;
  }

  if (currentText.length > 0) {
    blocks.push({ type: 'text', content: currentText.join('\n') });
  }

  return blocks;
}

export function generatePdfBlobUrl(title: string, content: string): string {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  
  let cursorY = 20; // Start cleanly at top margin, NO header banner!
  const pageWidth = 210;
  const margin = 14;
  const usableWidth = pageWidth - (margin * 2);

  // Document Title
  const safeTitle = sanitizeTextForPdf(title || "Professional Document");
  doc.setTextColor(15, 23, 42); // slate-900
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text(safeTitle, margin, cursorY);
  cursorY += 8;

  // Subtitle / Divider line
  doc.setDrawColor(0, 86, 179); // Deep blue accent #0056b3
  doc.setLineWidth(0.6);
  doc.line(margin, cursorY, pageWidth - margin, cursorY);
  cursorY += 10;

  const blocks = parseMarkdownBlocks(content);

  for (const block of blocks) {
    if (cursorY > 265) {
      doc.addPage();
      cursorY = 20;
    }

    if (block.type === 'text') {
      const textLines = block.content.split('\n');
      for (const rawLine of textLines) {
        const trimmed = rawLine.trim();
        if (!trimmed) {
          cursorY += 3;
          continue;
        }

        if (cursorY > 275) {
          doc.addPage();
          cursorY = 20;
        }

        const isHeading1 = trimmed.startsWith('# ');
        const isHeading2 = trimmed.startsWith('## ');
        const isHeading3 = trimmed.startsWith('### ');
        const isBullet = trimmed.startsWith('* ') || trimmed.startsWith('- ');
        const isHr = trimmed === '---' || trimmed === '___';

        if (isHr) {
          doc.setDrawColor(203, 213, 225);
          doc.setLineWidth(0.4);
          doc.line(margin, cursorY + 2, margin + usableWidth, cursorY + 2);
          cursorY += 8;
          continue;
        }

        let cleanLine = trimmed;
        if (isHeading1) cleanLine = trimmed.replace(/^#\s+/, '');
        else if (isHeading2) cleanLine = trimmed.replace(/^##\s+/, '');
        else if (isHeading3) cleanLine = trimmed.replace(/^###\s+/, '');
        else if (isBullet) cleanLine = '• ' + trimmed.replace(/^[\*\-]\s+/, '');

        // Strip inline markdown (bold, italic, code ticks)
        cleanLine = cleanLine
          .replace(/\*\*([^*]+)\*\*/g, '$1')
          .replace(/\*([^*]+)\*/g, '$1')
          .replace(/`([^`]+)`/g, '$1');

        cleanLine = sanitizeTextForPdf(cleanLine);
        if (!cleanLine) continue;

        if (isHeading1) {
          doc.setFont("helvetica", "bold");
          doc.setFontSize(14);
          doc.setTextColor(0, 86, 179);
          cursorY += 3;
        } else if (isHeading2) {
          doc.setFont("helvetica", "bold");
          doc.setFontSize(12);
          doc.setTextColor(15, 23, 42);
          cursorY += 2;
        } else if (isHeading3) {
          doc.setFont("helvetica", "bold");
          doc.setFontSize(11);
          doc.setTextColor(51, 65, 85);
          cursorY += 1;
        } else {
          doc.setFont("helvetica", "normal");
          doc.setFontSize(10.5);
          doc.setTextColor(51, 65, 85);
        }

        const indent = isBullet ? margin + 6 : margin;
        const lineWidth = isBullet ? usableWidth - 6 : usableWidth;

        const splitLines = doc.splitTextToSize(cleanLine, lineWidth);
        for (const l of splitLines) {
          if (cursorY > 275) {
            doc.addPage();
            cursorY = 20;
          }
          doc.text(l, indent, cursorY);
          cursorY += 5.5;
        }

        if (isHeading1 || isHeading2 || isHeading3) {
          cursorY += 3;
        }
      }
      cursorY += 4;
    } else if (block.type === 'code') {
      const rawCode = cleanCodeSnippet(block.content);
      const codeLines = rawCode.split('\n');
      const boxHeight = Math.max(15, (codeLines.length * 5) + 12);

      if (cursorY + boxHeight > 275) {
        doc.addPage();
        cursorY = 20;
      }

      // Dark background box (#1e1e1e)
      doc.setFillColor(30, 30, 30);
      doc.roundedRect(margin, cursorY, usableWidth, boxHeight, 2, 2, 'F');

      // Header label inside code block
      doc.setFont("courier", "bold");
      doc.setFontSize(8);
      doc.setTextColor(133, 133, 133);
      doc.text((block.language || 'code').toUpperCase(), margin + 4, cursorY + 5);

      // Code text in Courier / monospace
      doc.setFont("courier", "normal");
      doc.setFontSize(9);
      doc.setTextColor(212, 212, 212);

      let codeY = cursorY + 11;
      for (const cline of codeLines) {
        const safeCode = sanitizeTextForPdf(cline);
        if (codeY < cursorY + boxHeight - 3) {
          doc.text(safeCode.substring(0, 100), margin + 4, codeY);
        }
        codeY += 5;
      }

      cursorY += boxHeight + 8;
    } else if (block.type === 'table' && block.tableData) {
      if (cursorY > 230) {
        doc.addPage();
        cursorY = 20;
      }

      const safeHeaders = block.tableData.headers.map(h => sanitizeTextForPdf(h));
      const safeRows = block.tableData.rows.map(row => row.map(cell => sanitizeTextForPdf(cell)));

      (doc as any).autoTable({
        startY: cursorY,
        head: [safeHeaders],
        body: safeRows,
        theme: 'grid',
        headStyles: {
          fillColor: [0, 86, 179],
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          fontSize: 10,
        },
        bodyStyles: {
          textColor: [51, 65, 85],
          fontSize: 9.5,
        },
        alternateRowStyles: {
          fillColor: [248, 250, 252],
        },
        margin: { left: margin, right: margin },
      });

      cursorY = (doc as any).lastAutoTable.finalY + 10;
    }
  }

  // Footer page numbering
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(148, 163, 184);
    doc.text(`Generated by Kevin AI Assistant • Page ${i} of ${pageCount}`, margin, 290);
  }

  const pdfOutput = doc.output('blob');
  return URL.createObjectURL(pdfOutput);
}

export function generateDocxBlobUrl(title: string, content: string): string {
  const blocks = parseMarkdownBlocks(content);
  let formattedHtml = '';

  for (const block of blocks) {
    if (block.type === 'text') {
      const textLines = block.content.split('\n');
      for (const rawLine of textLines) {
        const trimmed = rawLine.trim();
        if (!trimmed) {
          formattedHtml += '<br/>';
          continue;
        }

        const isHeading1 = trimmed.startsWith('# ');
        const isHeading2 = trimmed.startsWith('## ');
        const isHeading3 = trimmed.startsWith('### ');
        const isBullet = trimmed.startsWith('* ') || trimmed.startsWith('- ');
        const isHr = trimmed === '---' || trimmed === '___';

        if (isHr) {
          formattedHtml += '<hr style="border: none; border-top: 1px solid #cbd5e1; margin: 16px 0;"/>';
          continue;
        }

        let cleanLine = trimmed;
        if (isHeading1) cleanLine = trimmed.replace(/^#\s+/, '');
        else if (isHeading2) cleanLine = trimmed.replace(/^##\s+/, '');
        else if (isHeading3) cleanLine = trimmed.replace(/^###\s+/, '');
        else if (isBullet) cleanLine = trimmed.replace(/^[\*\-]\s+/, '');

        cleanLine = cleanLine
          .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
          .replace(/\*([^*]+)\*/g, '<em>$1</em>')
          .replace(/`([^`]+)`/g, '<code style="background: #f1f5f9; padding: 2px 4px; border-radius: 4px; font-family: monospace;">$1</code>');

        if (isHeading1) {
          formattedHtml += `<h1 style="color: #0056b3; font-size: 20px; margin-top: 20px; margin-bottom: 10px; font-weight: bold; border-bottom: 2px solid #0056b3; padding-bottom: 4px;">${cleanLine}</h1>`;
        } else if (isHeading2) {
          formattedHtml += `<h2 style="color: #0f172a; font-size: 16px; margin-top: 18px; margin-bottom: 8px; font-weight: bold;">${cleanLine}</h2>`;
        } else if (isHeading3) {
          formattedHtml += `<h3 style="color: #334155; font-size: 14px; margin-top: 14px; margin-bottom: 6px; font-weight: bold;">${cleanLine}</h3>`;
        } else if (isBullet) {
          formattedHtml += `<li style="margin-left: 20px; margin-bottom: 4px; font-size: 14px;">${cleanLine}</li>`;
        } else {
          formattedHtml += `<p style="margin-bottom: 10px; font-size: 14px; line-height: 1.6;">${cleanLine}</p>`;
        }
      }
    } else if (block.type === 'code') {
      const rawCode = cleanCodeSnippet(block.content);
      const highlightedHtml = highlightCodeToHtml(rawCode);

      formattedHtml += `
        <div style="background: #1e1e1e; color: #d4d4d4; padding: 14px 16px; font-family: 'Consolas', 'Courier New', monospace; font-size: 13px; border-radius: 6px; margin: 16px 0; border: 1px solid #333333; line-height: 1.5; white-space: pre-wrap;">
          <div style="font-size: 10px; color: #858585; text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.5px; border-bottom: 1px solid #333333; padding-bottom: 4px; font-weight: bold;">${block.language || 'code'}</div>
          <div>${highlightedHtml}</div>
        </div>
      `;
    } else if (block.type === 'table' && block.tableData) {
      const { headers, rows } = block.tableData;
      let tableHtml = `<table><thead><tr>`;
      for (const h of headers) {
        tableHtml += `<th>${h}</th>`;
      }
      tableHtml += `</tr></thead><tbody>`;
      for (const row of rows) {
        tableHtml += `<tr>`;
        for (const cell of row) {
          tableHtml += `<td>${cell}</td>`;
        }
        tableHtml += `</tr>`;
      }
      tableHtml += `</tbody></table>`;
      formattedHtml += tableHtml;
    }
  }

  const htmlContent = `
    <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
    <head><meta charset="utf-8"><title>${title}</title><style>
      body { font-family: 'Calibri', Arial, sans-serif; line-height: 1.6; color: #334155; margin: 40px; }
      h1 { color: #0056b3; border-bottom: 2px solid #0056b3; padding-bottom: 8px; font-size: 24px; margin-bottom: 20px; }
      h2 { color: #0f172a; font-size: 18px; margin-top: 18px; margin-bottom: 8px; font-weight: bold; }
      h3 { color: #334155; font-size: 15px; margin-top: 14px; margin-bottom: 6px; font-weight: bold; }
      p { margin-bottom: 12px; font-size: 14px; }
      ul, li { margin-bottom: 4px; font-size: 14px; }
      table { width: 100%; border-collapse: collapse; margin: 16px 0; }
      th, td { border: 1px solid #cbd5e1; padding: 8px 12px; font-size: 13px; text-align: left; }
      th { background-color: #0056b3; color: #ffffff; font-weight: bold; }
      tr:nth-child(even) { background-color: #f8fafc; }
      .footer { margin-top: 40px; font-size: 10px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 10px; }
    </style></head>
    <body>
      <h1>${title || "Professional Document"}</h1>
      <div>${formattedHtml}</div>
      <div class="footer">Generated by Kevin AI Assistant</div>
    </body>
    </html>
  `;
  const blob = new Blob(['\ufeff' + htmlContent], {
    type: 'application/msword'
  });
  return URL.createObjectURL(blob);
}
