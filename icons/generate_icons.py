import struct
import zlib
import os

def write_png(filename, width, height, pixels):
    """
    Pure Python PNG encoder using standard library zlib and struct.
    pixels is a list of byte rows, each row containing (R, G, B, A) per pixel.
    """
    # PNG Signature
    png_sig = b'\x89PNG\r\n\x1a\n'
    
    # IHDR Chunk
    ihdr_data = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    ihdr_crc = zlib.crc32(ihdr_data)
    ihdr = struct.pack('>I', len(ihdr_data)) + b'IHDR' + ihdr_data + struct.pack('>I', ihdr_crc)
    
    # IDAT Chunk (raw image scanlines with filter byte 0 pre-pended to each row)
    raw_rows = []
    for row in pixels:
        raw_rows.append(b'\x00' + row)
    raw_data = b''.join(raw_rows)
    compressed_data = zlib.compress(raw_data, 9)
    idat_crc = zlib.crc32(b'IDAT' + compressed_data)
    idat = struct.pack('>I', len(compressed_data)) + b'IDAT' + compressed_data + struct.pack('>I', idat_crc)
    
    # IEND Chunk
    iend = struct.pack('>I', 0) + b'IEND' + struct.pack('>I', zlib.crc32(b'IEND'))
    
    with open(filename, 'wb') as f:
        f.write(png_sig + ihdr + idat + iend)

def generate_icon(filename, size):
    """
    Generates a sleek gradient icon with a rounded inner card and stylized 'S' checkmark accent.
    """
    pixels = []
    center = size / 2.0
    radius = size * 0.22
    
    for y in range(size):
        row_bytes = bytearray()
        for x in range(size):
            # Gradient background from deep navy (#0f172a) to vibrant blue (#3b82f6)
            t = (x + y) / (2.0 * size)
            r = int(15 * (1 - t) + 59 * t)
            g = int(23 * (1 - t) + 130 * t)
            b = int(42 * (1 - t) + 246 * t)
            a = 255
            
            # Draw rounded center icon box / white frame accent
            dx = abs(x - center)
            dy = abs(y - center)
            box_size = size * 0.32
            
            # Draw a stylized checkmark or 'S' inside
            if dx < box_size and dy < box_size:
                # Add subtle glow inside center card
                r = min(255, int(r * 1.3))
                g = min(255, int(g * 1.3))
                b = min(255, int(b * 1.3))
                
                # Draw white accent bar representing attendance check/S shape
                if (abs(x - center) < size * 0.18 and abs(y - center) < size * 0.04) or \
                   (abs(x - (center - size * 0.14)) < size * 0.04 and y > center - size * 0.18 and y <= center) or \
                   (abs(x - (center + size * 0.14)) < size * 0.04 and y >= center and y < center + size * 0.18):
                    r, g, b = 255, 255, 255
                    
            row_bytes.extend([r, g, b, a])
        pixels.append(bytes(row_bytes))
        
    write_png(filename, size, size, pixels)
    print(f"Generated {filename} ({size}x{size})")

if __name__ == '__main__':
    script_dir = os.path.dirname(os.path.abspath(__file__))
    generate_icon(os.path.join(script_dir, 'icon-192.png'), 192)
    generate_icon(os.path.join(script_dir, 'icon-512.png'), 512)
    print("All PWA icons successfully generated using pure Python!")
