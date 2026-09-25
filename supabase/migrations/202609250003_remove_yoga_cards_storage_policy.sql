-- The yoga-cards bucket has been retired. Remove its obsolete public-read rule.
drop policy if exists "Public read access to yoga cards" on storage.objects;
