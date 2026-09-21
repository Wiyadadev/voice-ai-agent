import os
import whisper

INPUT_DIR = r"call-data\recordings"
OUTPUT_DIR = r"call-data\transcripts"

os.makedirs(OUTPUT_DIR, exist_ok=True)

# โหลดโมเดลครั้งเดียว
print("กำลังโหลด Whisper model...")
model = whisper.load_model("small")
print("โหลดโมเดลสำเร็จ!\n")

# หาไฟล์ MP3 ทั้งหมด
audio_files = sorted([
    f for f in os.listdir(INPUT_DIR)
    if f.lower().endswith(".mp3")
])

total = len(audio_files)

print(f"พบไฟล์ทั้งหมด {total} ไฟล์\n")

for index, filename in enumerate(audio_files, start=1):
    audio_path = os.path.join(INPUT_DIR, filename)
    output_name = os.path.splitext(filename)[0] + ".txt"
    output_path = os.path.join(OUTPUT_DIR, output_name)

    # ข้ามไฟล์ที่ถอดเสร็จแล้ว
    if os.path.exists(output_path):
        print(f"[{index}/{total}] ข้าม {filename} (เสร็จแล้ว)")
        continue

    print(f"\n[{index}/{total}] กำลังถอดเสียง: {filename}")

    try:
        result = model.transcribe(
            audio_path,
            language="ru",
            fp16=False
        )

        with open(output_path, "w", encoding="utf-8") as f:
            f.write(result["text"].strip())

        print(f"สำเร็จ: {output_name}")

    except Exception as e:
        print(f"ERROR: {filename}")
        print(e)

print("\nเสร็จสิ้น!")