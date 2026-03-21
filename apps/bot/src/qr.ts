import QRCode from 'qrcode';
import { InputFile } from 'grammy';

/**
 * Generate a QR code PNG buffer with white padding around it.
 * Returns a Grammy InputFile ready to send via replyWithPhoto.
 */
export async function qrInputFile(data: string, caption?: string): Promise<{ source: InputFile; caption?: string }> {
  const buf = await QRCode.toBuffer(data, {
    type: 'png',
    width: 300,
    margin: 3,           // ~3 module padding on each side
    errorCorrectionLevel: 'M',
    color: { dark: '#000000', light: '#ffffff' },
  });

  return {
    source: new InputFile(buf, 'qr.png'),
    ...(caption ? { caption } : {}),
  };
}
