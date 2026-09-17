-- Installs the RPC only; no existing time-off rows are changed.
CREATE OR REPLACE FUNCTION public.exclude_time_off_date(
  p_actor_id uuid, p_request_id uuid, p_exclude_date date
) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  r public.time_off_requests%ROWTYPE;
  shop_owner uuid;
BEGIN
  SELECT * INTO r FROM public.time_off_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found' USING ERRCODE = 'P0002'; END IF;
  SELECT s.owner_id INTO shop_owner FROM public.shops s WHERE s.id = r.shop_id FOR SHARE;
  IF p_actor_id IS NULL OR shop_owner IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF r.status IS DISTINCT FROM 'approved' OR r.type NOT IN ('day_off', 'vacation', 'sick')
    OR p_exclude_date IS NULL OR p_exclude_date < r.start_date OR p_exclude_date > r.end_date
  THEN RAISE EXCEPTION 'Invalid exclusion' USING ERRCODE = '22023'; END IF;

  IF r.start_date = r.end_date THEN
    DELETE FROM public.time_off_requests WHERE id = r.id;
  ELSIF p_exclude_date = r.start_date THEN
    UPDATE public.time_off_requests SET start_date = r.start_date + 1 WHERE id = r.id;
  ELSIF p_exclude_date = r.end_date THEN
    UPDATE public.time_off_requests SET end_date = r.end_date - 1 WHERE id = r.id;
  ELSE
    UPDATE public.time_off_requests SET end_date = p_exclude_date - 1 WHERE id = r.id;
    INSERT INTO public.time_off_requests
      (barber_id, shop_id, type, start_date, end_date, start_time, end_time, reason, status, decided_by, decided_at, created_at)
    VALUES
      (r.barber_id, r.shop_id, r.type, p_exclude_date + 1, r.end_date, r.start_time, r.end_time, r.reason, r.status, r.decided_by, r.decided_at, r.created_at);
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.exclude_time_off_date(uuid, uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exclude_time_off_date(uuid, uuid, date) TO service_role;
