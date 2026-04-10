-- 사용자 표시명(닉네임): 로그인 ID(username)와 분리.
ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS nickname TEXT NULL;

-- 기존 사용자/초기 상태: 닉네임이 비어있으면 username으로 채움.
UPDATE public.users
SET nickname = username
WHERE nickname IS NULL OR TRIM(COALESCE(nickname, '')) = '';

COMMENT ON COLUMN public.users.nickname IS 'Display name shown in UI; separate from login username.';
