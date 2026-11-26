import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { generateDocument } from '../services/documentService';

/**
 * Draws the signature watermark onto the image canvas:
 * "Kevin" in crisp white, and "AI" in bold vibrant orange.
 */
export function applyKevinAIWatermark(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const scale = Math.max(Math.min(width, height) / 1024, 0.55);
  const padding = 24 * scale;
  const badgeHeight = 44 * scale;
  const fontSize = 20 * scale;
  const radius = 12 * scale;

  ctx.save();

  // Typography measurements
  ctx.font = `700 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  const kevinText = "Izi ";
  const kevinWidth = ctx.measureText(kevinText).width;

  ctx.font = `900 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  const aiText = "AI";
  const aiWidth = ctx.measureText(aiText).width;

  const totalTextWidth = kevinWidth + aiWidth;
  const badgeWidth = totalTextWidth + 36 * scale;
  
  // Position in bottom-right corner
  const x = width - badgeWidth - padding;
  const y = height - badgeHeight - padding;

  // 1. Badge Shadow
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
  ctx.shadowBlur = 12 * scale;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 4 * scale;

  // 2. Translucent dark luxury capsule container
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, badgeWidth, badgeHeight, radius);
  } else {
    ctx.rect(x, y, badgeWidth, badgeHeight);
  }
  ctx.fillStyle = 'rgba(12, 16, 20, 0.85)';
  ctx.fill();

  // Subtle border outline
  ctx.lineWidth = 1.5 * scale;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
  ctx.stroke();

  // Reset shadow for text rendering
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  // 3. Small orange spark dot on the left
  const dotX = x + 14 * scale;
  const dotY = y + badgeHeight / 2;
  ctx.beginPath();
  ctx.arc(dotX, dotY, 3.5 * scale, 0, Math.PI * 2);
  ctx.fillStyle = '#FF6600'; // Bold vibrant orange
  ctx.fill();

  // 4. "Kevin " in white
  const textStartX = x + 24 * scale;
  const textBaselineY = y + (badgeHeight / 2) + (fontSize * 0.35);

  ctx.font = `700 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(kevinText, textStartX, textBaselineY);

  // 5. "AI" in Bold Orange
  ctx.font = `900 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  ctx.fillStyle = '#FF6600'; // Bold Orange
  ctx.fillText(aiText, textStartX + kevinWidth, textBaselineY);

  ctx.restore();
}

/**
 * Loads an image from URL or base64 into an HTMLImageElement with CORS handling
 */
async function loadImageElement(src: string): Promise<HTMLImageElement> {
  if (src.startsWith('data:')) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Cross-origin load failed'));
      img.src = src;
    });
  } catch {
    const response = await fetch(src);
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(img);
      };
      img.onerror = (e) => {
        URL.revokeObjectURL(objectUrl);
        reject(e);
      };
      img.src = objectUrl;
    });
  }
}

/**
 * Downloads image directly with 4.5% bottom crop to eliminate pollinations watermark
 * and burned-in "Kevin AI (bold orange)" watermark badge.
 */
export async function downloadAIImage(imageUrl: string, filename = `kevin_ai_${Date.now()}.jpg`): Promise<{ success: boolean; path?: string }> {
  try {
    const img = await loadImageElement(imageUrl);

    // 1. AUTO-CROP BOTTOM 4.5% to completely eliminate any external watermarks
    const cropHeight = Math.round(img.naturalHeight * 0.045);
    const targetWidth = img.naturalWidth || img.width || 1024;
    const targetHeight = (img.naturalHeight || img.height || 1024) - cropHeight;

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Cannot get canvas context');

    // 2. Draw the cropped image (removing the watermark area cleanly)
    ctx.drawImage(
      img,
      0, 0, img.naturalWidth || img.width, targetHeight,
      0, 0, targetWidth, targetHeight
    );

    // 3. RENDER KEVIN AI BRANDING BADGE (Bottom-Right corner)
    const badgeHeight = Math.max(38, Math.round(targetHeight * 0.048));
    const badgeWidth = Math.max(150, Math.round(targetWidth * 0.18));
    const margin = Math.max(16, Math.round(targetWidth * 0.025));

    const badgeX = targetWidth - badgeWidth - margin;
    const badgeY = targetHeight - badgeHeight - margin;
    const radius = badgeHeight / 2;

    // Draw dark solid WhatsApp slate pill background
    ctx.save();
    ctx.fillStyle = "rgba(17, 27, 33, 0.92)"; // WhatsApp Dark Slate
    ctx.shadowColor = "rgba(0, 0, 0, 0.7)";
    ctx.shadowBlur = 12;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(badgeX, badgeY, badgeWidth, badgeHeight, radius);
    } else {
      ctx.rect(badgeX, badgeY, badgeWidth, badgeHeight);
    }
    ctx.fill();

    // Draw subtle border
    ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    // Draw Glowing Orange indicator dot
    const dotRadius = badgeHeight * 0.14;
    const dotX = badgeX + (badgeHeight * 0.45);
    const dotY = badgeY + (badgeHeight / 2);

    ctx.save();
    ctx.fillStyle = "#FF6B00"; // Vibrant Orange
    ctx.shadowColor = "#FF6B00";
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(dotX, dotY, dotRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Render Typography: "Kevin " (White) + "AI" (Bold Orange)
    const fontSize = Math.round(badgeHeight * 0.44);
    ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.textBaseline = "middle";

    const textStartX = dotX + dotRadius + 8;
    ctx.fillStyle = "#FFFFFF";
    ctx.fillText("Izi ", textStartX, badgeY + (badgeHeight / 2));

    const kevinWidth = ctx.measureText("Izi ").width;
    ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.fillStyle = "#FF6B00"; // Bold Orange
    ctx.fillText("AI", textStartX + kevinWidth, badgeY + (badgeHeight / 2));

    const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
    const base64Data = dataUrl.replace(/^data:image\/jpeg;base64,/, '');

    if (Capacitor.isNativePlatform()) {
      try {
        const result = await Filesystem.writeFile({
          path: `Download/${filename}`,
          data: base64Data,
          directory: Directory.ExternalStorage,
          recursive: true
        });
        return { success: true, path: result.uri };
      } catch (err) {
        console.warn('Direct Download directory save failed, falling back to Documents:', err);
        const docResult = await Filesystem.writeFile({
          path: filename,
          data: base64Data,
          directory: Directory.Documents,
          recursive: true
        });
        return { success: true, path: docResult.uri };
      }
    }

    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.95));
    if (blob) {
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1500);
    } else {
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }

    return { success: true };
  } catch (error) {
    console.error('Error downloading watermarked image:', error);
    const link = document.createElement('a');
    link.href = imageUrl;
    link.download = filename;
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    return { success: true };
  }
}

/**
 * Downloads generated document (PDF, Word, or TXT) using Capacitor Filesystem on native Android
 * or Blob URL / anchor download on web.
 */
export async function downloadDocumentFile(url: string, filename: string, content?: string, title?: string, format?: 'pdf' | 'docx' | 'txt'): Promise<{ success: boolean; path?: string; error?: any }> {
  try {
    let activeUrl = url;
    if ((!activeUrl || !activeUrl.startsWith('blob:')) && content && format) {
      activeUrl = await generateDocument(title || filename.replace(/\.[^/.]+$/, ''), content, format);
    }

    if (Capacitor.isNativePlatform()) {
      const response = await fetch(activeUrl);
      const blob = await response.blob();
      const reader = new FileReader();
      const base64Data = await new Promise<string>((resolve, reject) => {
        reader.onloadend = () => {
          const res = reader.result as string;
          resolve(res.includes(',') ? res.split(',')[1] : res);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      try {
        const result = await Filesystem.writeFile({
          path: `Download/${filename}`,
          data: base64Data,
          directory: Directory.ExternalStorage,
          recursive: true
        });
        return { success: true, path: result.uri };
      } catch (err) {
        console.warn('ExternalStorage save failed, falling back to Documents:', err);
        const docResult = await Filesystem.writeFile({
          path: filename,
          data: base64Data,
          directory: Directory.Documents,
          recursive: true
        });
        return { success: true, path: docResult.uri };
      }
    } else {
      const link = document.createElement('a');
      link.href = activeUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return { success: true };
    }
  } catch (error) {
    console.error('Error downloading document file:', error);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    return { success: false, error };
  }
}

