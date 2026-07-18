-- 공유 스토리지 등록 시 실제 mkfs/mount까지 수행하도록 확장 — 마운트 경로/파일시스템 타입 기록.
ALTER TABLE storage_devices
    ADD COLUMN mount_path VARCHAR(255),
    ADD COLUMN fstype     VARCHAR(20);
