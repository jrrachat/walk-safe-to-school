-- Limit guardian preferences to the three route factors shown in the app.
create or replace function public.valid_weights(w jsonb)
returns boolean
language plpgsql
immutable
set search_path=''
as $$
declare k text;
begin
  if w is null or jsonb_typeof(w) <> 'object' then return false; end if;
  if (select count(*) from jsonb_object_keys(w)) <> 3 then return false; end if;
  foreach k in array array['sidewalk', 'crossings', 'speed'] loop
    if not (w ? k) or jsonb_typeof(w -> k) <> 'number' then return false; end if;
    if (w ->> k)::numeric < 0 or (w ->> k)::numeric > 10 then return false; end if;
  end loop;
  return true;
end
$$;

update public.risk_preferences
set weights = jsonb_build_object(
  'sidewalk', coalesce((weights ->> 'sidewalk')::numeric, 9),
  'crossings', coalesce((weights ->> 'crossings')::numeric, 7),
  'speed', coalesce((weights ->> 'speed')::numeric, 6)
);
