// Shrinks a screenshot or photo before upload: longest side 1600 px, JPEG.
// Phone photos of 4-8 MB become about 200-400 KB, still sharp enough to read.
export async function shrinkPhoto(file: Blob, max = 1600, quality = 0.82): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('Please choose a picture (JPG, PNG or a screenshot).');
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) throw new Error('This picture could not be opened.');
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff'; // transparent PNG screenshots get a white background
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return await new Promise<Blob>((ok, no) => canvas.toBlob((b) => (b ? ok(b) : no(new Error('Could not shrink the picture.'))), 'image/jpeg', quality));
}
