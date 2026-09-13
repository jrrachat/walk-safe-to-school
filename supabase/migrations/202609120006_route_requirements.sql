-- Store hard route requirements as four booleans in the existing preference JSON.
create or replace function public.valid_weights(w jsonb)
returns boolean
language plpgsql
immutable
set search_path=''
as $$
declare k text;
begin
  if w is null or jsonb_typeof(w) <> 'object' then return false; end if;
  if (select count(*) from jsonb_object_keys(w)) <> 4 then return false; end if;
  foreach k in array array['speed', 'crosswalks', 'sidewalks', 'signals'] loop
    if not (w ? k) or jsonb_typeof(w -> k) <> 'boolean' then return false; end if;
  end loop;
  return true;
end
$$;

update public.risk_preferences
set weights = jsonb_build_object(
  'speed', false,
  'crosswalks', false,
  'sidewalks', false,
  'signals', false
);
