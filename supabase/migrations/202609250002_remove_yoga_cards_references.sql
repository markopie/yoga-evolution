-- The yoga-cards media set is no longer used by the application.
-- Remove stale public URLs and manifest rows before deleting the bucket.
update public.asanas
set image_url = null
where image_url ilike '%yoga-cards%';

update public.stages
set image_url = null
where image_url ilike '%yoga-cards%';

delete from public.media_assets
where original_bucket = 'yoga-cards';
