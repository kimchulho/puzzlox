-- 방 입장용 비밀번호: 컬럼명 `password` 는 일부 클라이언트/게이트웨이에서 필드가 제거·무시되는 경우가 있어 `room_password` 로 저장한다.
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS room_password TEXT NULL;

UPDATE public.rooms
SET room_password = NULLIF(TRIM(password), '')
WHERE room_password IS NULL
  AND password IS NOT NULL
  AND TRIM(COALESCE(password, '')) <> '';

COMMENT ON COLUMN public.rooms.room_password IS 'Join password when has_password is true; stored separately from legacy password column.';
