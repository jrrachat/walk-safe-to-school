-- Preserve school identity for custom-named saved destinations.
alter table public.saved_locations add column place_kind text check (place_kind is null or place_kind = 'School');
