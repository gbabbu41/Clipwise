-- Apply before deploying the schedule API. A single transaction preserves the
-- existing hours and breaks if either replacement fails. No existing rows change
-- when this migration is installed.
CREATE OR REPLACE FUNCTION public.replace_barber_schedule(
  p_actor_id uuid, p_barber_id uuid, p_slots jsonb, p_breaks jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  b public.barbers%ROWTYPE;
  owner_id uuid;
BEGIN
  SELECT * INTO b FROM public.barbers WHERE id = p_barber_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Barber not found'; END IF;
  SELECT s.owner_id INTO owner_id FROM public.shops s WHERE s.id = b.shop_id FOR SHARE;
  IF p_actor_id IS NULL OR owner_id IS NULL OR
    (p_actor_id <> owner_id AND (b.user_id IS DISTINCT FROM p_actor_id OR b.is_active IS DISTINCT FROM true OR b.permissions->>'edit_schedule' = 'false'))
  THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF p_slots IS NULL OR p_breaks IS NULL OR jsonb_typeof(p_slots) <> 'array' OR jsonb_typeof(p_breaks) <> 'array' THEN
    RAISE EXCEPTION 'Invalid schedule';
  END IF;
  IF jsonb_array_length(p_slots) > 7 OR jsonb_array_length(p_breaks) > 70 THEN RAISE EXCEPTION 'Invalid schedule'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_slots) AS s(day_of_week integer, start_time time, end_time time)
    WHERE day_of_week IS NULL OR day_of_week NOT BETWEEN 0 AND 6 OR start_time IS NULL OR end_time IS NULL OR start_time >= end_time
  ) OR EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_slots) AS s(day_of_week integer) GROUP BY day_of_week HAVING count(*) > 1
  ) THEN RAISE EXCEPTION 'Invalid working hours'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_breaks) AS r(day_of_week integer, start_time time, end_time time, label text)
    WHERE r.start_time IS NULL OR r.end_time IS NULL OR r.start_time >= r.end_time OR length(r.label) > 100 OR NOT EXISTS (
      SELECT 1 FROM jsonb_to_recordset(p_slots) AS s(day_of_week integer, start_time time, end_time time)
      WHERE s.day_of_week = r.day_of_week AND r.start_time >= s.start_time AND r.end_time <= s.end_time
    )
  ) THEN RAISE EXCEPTION 'Invalid breaks'; END IF;
  DELETE FROM public.time_slots WHERE barber_id = b.id;
  INSERT INTO public.time_slots (barber_id, day_of_week, start_time, end_time, is_available)
    SELECT b.id, s.day_of_week, s.start_time, s.end_time, true
    FROM jsonb_to_recordset(p_slots) AS s(day_of_week integer, start_time time, end_time time);
  DELETE FROM public.barber_breaks WHERE barber_id = b.id;
  INSERT INTO public.barber_breaks (barber_id, shop_id, day_of_week, start_time, end_time, label)
    SELECT b.id, b.shop_id, r.day_of_week, r.start_time, r.end_time, coalesce(nullif(r.label, ''), 'Break')
    FROM jsonb_to_recordset(p_breaks) AS r(day_of_week integer, start_time time, end_time time, label text);
END;
$$;
REVOKE ALL ON FUNCTION public.replace_barber_schedule(uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_barber_schedule(uuid, uuid, jsonb, jsonb) TO service_role;
