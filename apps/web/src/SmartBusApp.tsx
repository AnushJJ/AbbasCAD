import { FormEvent, useEffect, useMemo, useState } from 'react';
import './app.css';

type City = { id: string; name: string; code: string };
type User = { id: string; username: string; email: string; name: string; phone: string | null; role: 'CUSTOMER' | 'ADMIN' };
type Seat = { id: string; number: string; category: string; premium: boolean; farePaise: number; available: boolean; status: string };
type Trip = {
  id: string;
  bus: { id: string; name: string; operator: string; type: string };
  origin: City;
  destination: City;
  departureAt: string;
  arrivalAt: string;
  durationMinutes: number;
  distanceKm: number;
  totalSeats: number;
  availableSeats: number;
  availableSeatDetails: Array<Omit<Seat, 'available' | 'status'>>;
  fare: { currency: 'INR'; minimumPaise: number | null; maximumPaise: number | null };
};
type Booking = {
  id: string;
  status: string;
  totalPaise: number;
  createdAt: string;
  seats: Array<{ id: string; seatId: string; number?: string; farePaise: number }>;
  payment: { status: string } | null;
  cancellation?: { refundPaise: number; reason: string | null } | null;
  trip: { departureAt: string; route: { origin: City; destination: City }; bus: { name: string } };
};
type Hold = { id: string; expiresAt: string; seats: Array<{ seatId: string; farePaise: number }> };
type Loyalty = { travelledKm: number; rewardThresholdKm: number; rewardAvailable: boolean; rewardRedeemedAt: string | null; rewardDescription: string };
type View = 'search' | 'bookings' | 'rewards' | 'profile' | 'admin';
type AdminKind = 'cities' | 'routes' | 'buses' | 'trips' | 'pricing-rules' | 'bookings';
type AdminRow = Record<string, any>;

const apiBase = (import.meta.env.DEV ? '' : (import.meta.env.VITE_API_URL || '')).replace(/\/$/, '');

class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly data: any) { super(message); }
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(apiBase + path, { ...init, headers, credentials: 'include' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(data.error?.message || 'The request could not be completed.', response.status, data);
  return data as T;
}

function dateIST(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || '';
  return value('year') + '-' + value('month') + '-' + value('day');
}

function datetimeISTInput(value: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || '';
  return part('year') + '-' + part('month') + '-' + part('day') + 'T' + part('hour') + ':' + part('minute');
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value));
}

function money(paise: number | null | undefined) {
  if (paise === null || paise === undefined) return '—';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(paise / 100);
}

function shortKey(prefix: string) {
  return prefix + '-' + crypto.randomUUID();
}

function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    bus: 'M5 16V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v11M5 11h14M7 16v3m10-3v3M7 7h.01M17 7h.01M7 19h.01M17 19h.01',
    search: 'm21 21-4.35-4.35M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z',
    ticket: 'M3 8V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a3 3 0 0 0 0 6v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a3 3 0 0 0 0-6Zm9-4v2m0 3v2m0 3v2m0 3v1',
    sun: 'M12 3v2m0 14v2M5.64 5.64l1.42 1.42m9.88 9.88 1.42 1.42M3 12h2m14 0h2M5.64 18.36l1.42-1.42m9.88-9.88 1.42-1.42M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
    moon: 'M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z',
    user: 'M20 21a8 8 0 0 0-16 0m8-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
    shield: 'M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Zm-3-11 2 2 4-4',
    close: 'm18 6-12 12M6 6l12 12',
    arrow: 'M5 12h14m-7-7 7 7-7 7',
  };
  return <svg aria-hidden="true" className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name] || paths.bus} /></svg>;
}

function App() {
  const [view, setView] = useState<View>('search');
  const [cities, setCities] = useState<City[]>([]);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [theme, setTheme] = useState<'light' | 'dark'>(() => localStorage.getItem('smartbus-theme') === 'dark' ? 'dark' : 'light');
  const [originId, setOriginId] = useState('');
  const [destinationId, setDestinationId] = useState('');
  const [journeyDate, setJourneyDate] = useState(() => dateIST(new Date()));
  const [trips, setTrips] = useState<Trip[]>([]);
  const [searching, setSearching] = useState(false);
  const [citiesLoading, setCitiesLoading] = useState(true);
  const [searched, setSearched] = useState(false);
  const [globalError, setGlobalError] = useState('');
  const [notice, setNotice] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');
  const [seatTrip, setSeatTrip] = useState<Trip | null>(null);
  const [seatMap, setSeatMap] = useState<Seat[]>([]);
  const [seatLoading, setSeatLoading] = useState(false);
  const [selectedSeats, setSelectedSeats] = useState<string[]>([]);
  const [hold, setHold] = useState<Hold | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [paymentMode, setPaymentMode] = useState<'success' | 'failure'>('success');
  const [applyReward, setApplyReward] = useState(false);
  const [bookingBusy, setBookingBusy] = useState(false);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loyalty, setLoyalty] = useState<Loyalty | null>(null);
  const [profileName, setProfileName] = useState('');
  const [profilePhone, setProfilePhone] = useState('');
  const [profileBusy, setProfileBusy] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('smartbus-theme', theme);
  }, [theme]);

  useEffect(() => {
    let live = true;
    api<{ cities: City[] }>('/api/cities').then((data) => { if (live) setCities(data.cities); })
      .catch((error: unknown) => { if (live) setGlobalError(error instanceof Error ? error.message : 'Could not load cities.'); })
      .finally(() => { if (live) setCitiesLoading(false); });
    api<{ user: User; loyalty: Loyalty }>('/api/auth/me').then((data) => { if (live) setCurrentUser(data.user); }).catch(() => undefined);
    return () => { live = false; };
  }, []);

  function setCurrentUser(user: User | null) {
    setAuthUser(user);
    if (user) {
      setProfileName(user.name);
      setProfilePhone(user.phone || '');
      loadLoyalty();
    } else {
      setBookings([]);
      setLoyalty(null);
    }
  }

  async function loadLoyalty() {
    try { setLoyalty(await api<Loyalty>('/api/loyalty')); } catch { setLoyalty(null); }
  }

  async function loadBookings() {
    try { setBookings((await api<{ bookings: Booking[] }>('/api/bookings')).bookings); }
    catch (error) { setGlobalError(error instanceof Error ? error.message : 'Could not load bookings.'); }
  }

  async function changeView(next: View) {
    setGlobalError(''); setNotice(''); setView(next);
    if (next === 'bookings') await loadBookings();
    if (next === 'rewards') await loadLoyalty();
    if (next === 'admin' && authUser?.role !== 'ADMIN') { setView('search'); setNotice('Administrator access is required.'); }
  }

  async function searchTrips(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setGlobalError(''); setNotice(''); setSearched(true); setTrips([]);
    if (!originId || !destinationId || !journeyDate) { setGlobalError('Choose an origin, destination, and journey date.'); return; }
    if (originId === destinationId) { setGlobalError('Choose two different cities.'); return; }
    if (journeyDate < dateIST(new Date())) { setGlobalError('Choose today or a future journey date.'); return; }
    setSearching(true);
    try {
      const params = new URLSearchParams({ originId, destinationId, date: journeyDate });
      setTrips((await api<{ trips: Trip[] }>('/api/trips/search?' + params.toString())).trips);
    } catch (error) { setGlobalError(error instanceof Error ? error.message : 'Could not search buses.'); }
    finally { setSearching(false); }
  }

  async function showSeats(trip: Trip) {
    setGlobalError(''); setNotice('');
    if (!authUser) { setAuthMode('login'); setAuthOpen(true); setNotice('Sign in to choose seats and book this trip.'); return; }
    setSeatTrip(trip); setSelectedSeats([]); setHold(null); setSeatLoading(true);
    try { setSeatMap((await api<{ seats: Seat[] }>('/api/trips/' + trip.id + '/seats')).seats); }
    catch (error) { setGlobalError(error instanceof Error ? error.message : 'Could not load seats.'); }
    finally { setSeatLoading(false); }
  }

  function toggleSeat(seat: Seat) {
    if (hold || !seat.available) return;
    setSelectedSeats((current) => current.includes(seat.id) ? current.filter((id) => id !== seat.id) : current.length >= 6 ? current : [...current, seat.id]);
  }

  async function createHold() {
    if (!seatTrip || selectedSeats.length === 0) return;
    setBookingBusy(true); setGlobalError('');
    try {
      const result = await api<{ hold: Hold }>('/api/trips/' + seatTrip.id + '/holds', {
        method: 'POST', headers: { 'Idempotency-Key': shortKey('hold') }, body: JSON.stringify({ seatIds: selectedSeats }),
      });
      setHold(result.hold); setSelectedSeats([]);
      setSeatMap((await api<{ seats: Seat[] }>('/api/trips/' + seatTrip.id + '/seats')).seats);
    } catch (error) { setGlobalError(error instanceof Error ? error.message : 'Could not hold the selected seats.'); }
    finally { setBookingBusy(false); }
  }

  async function releaseHold() {
    if (!hold || !seatTrip) return;
    setBookingBusy(true);
    try {
      await api('/api/holds/' + hold.id, { method: 'DELETE' });
      setHold(null); setApplyReward(false);
      setSeatMap((await api<{ seats: Seat[] }>('/api/trips/' + seatTrip.id + '/seats')).seats);
    } catch (error) { setGlobalError(error instanceof Error ? error.message : 'Could not release this hold.'); }
    finally { setBookingBusy(false); }
  }

  async function confirmBooking() {
    if (!hold || !seatTrip) return;
    setBookingBusy(true); setGlobalError('');
    try {
      const path = applyReward ? '/api/loyalty/redeem' : '/api/bookings';
      const response = await fetch(apiBase + path, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': shortKey('booking') },
        body: JSON.stringify({ holdId: hold.id, simulateFailure: paymentMode === 'failure' }),
      });
      const data = await response.json();
      if (response.status === 402) {
        setGlobalError(data.error?.message || 'The simulated payment failed. Your seats have been released.');
        setHold(null); setApplyReward(false);
        setSeatMap((await api<{ seats: Seat[] }>('/api/trips/' + seatTrip.id + '/seats')).seats);
        return;
      }
      if (!response.ok) throw new ApiError(data.error?.message || 'Could not complete this booking.', response.status, data);
      setNotice('Booking confirmed. Your simulated payment was successful.');
      setHold(null); setSeatTrip(null); setApplyReward(false); setSelectedSeats([]);
      setView('bookings'); await loadBookings(); await loadLoyalty();
    } catch (error) { setGlobalError(error instanceof Error ? error.message : 'Could not complete this booking.'); }
    finally { setBookingBusy(false); }
  }

  async function cancelBooking(booking: Booking) {
    if (!window.confirm('Cancel this booking? The simulated refund will be recorded and its seats released.')) return;
    setGlobalError('');
    try {
      await api('/api/bookings/' + booking.id + '/cancel', { method: 'POST', headers: { 'Idempotency-Key': shortKey('cancel') }, body: JSON.stringify({ reason: 'Cancelled by customer' }) });
      setNotice('Booking cancelled and simulated refund recorded.'); await loadBookings();
    } catch (error) { setGlobalError(error instanceof Error ? error.message : 'Could not cancel this booking.'); }
  }

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setAuthBusy(true); setAuthError('');
    const form = new FormData(event.currentTarget);
    const payload: Record<string, string> = {};
    form.forEach((value, key) => { payload[key] = String(value); });
    try {
      const result = await api<{ user: User }>('/api/auth/' + authMode, { method: 'POST', body: JSON.stringify(payload) });
      setCurrentUser(result.user); setAuthOpen(false); setNotice(authMode === 'register' ? 'Your SmartBus account is ready.' : 'Welcome back, ' + result.user.name + '.');
      if (seatTrip) {
        setSeatLoading(true);
        try { setSeatMap((await api<{ seats: Seat[] }>('/api/trips/' + seatTrip.id + '/seats')).seats); }
        catch (error) { setGlobalError(error instanceof Error ? error.message : 'Could not load seats.'); }
        finally { setSeatLoading(false); }
      }
    } catch (error) { setAuthError(error instanceof Error ? error.message : 'Could not sign in.'); }
    finally { setAuthBusy(false); }
  }

  async function logout() {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* Local UI still clears; cookie expires server-side. */ }
    setCurrentUser(null); setView('search'); setNotice('You have been signed out.');
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setProfileBusy(true); setGlobalError('');
    try {
      const result = await api<{ user: User }>('/api/auth/profile', { method: 'PATCH', body: JSON.stringify({ name: profileName, phone: profilePhone }) });
      setCurrentUser(result.user); setNotice('Profile updated.');
    } catch (error) { setGlobalError(error instanceof Error ? error.message : 'Could not save your profile.'); }
    finally { setProfileBusy(false); }
  }

  const selectedFare = useMemo(() => hold ? hold.seats.reduce((sum, seat) => sum + seat.farePaise, 0) : seatMap.filter((seat) => selectedSeats.includes(seat.id)).reduce((sum, seat) => sum + seat.farePaise, 0), [hold, seatMap, selectedSeats]);

  useEffect(() => {
    if (!hold) { setSecondsLeft(0); return; }
    const update = () => setSecondsLeft(Math.max(0, Math.floor((new Date(hold.expiresAt).getTime() - Date.now()) / 1000)));
    update(); const timer = window.setInterval(update, 1000); return () => window.clearInterval(timer);
  }, [hold]);

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="#search" onClick={(event) => { event.preventDefault(); void changeView('search'); }}><span className="brand-mark"><Icon name="bus" /></span><span>smartbus<span className="brand-dot">.</span></span></a>
        <nav className="main-nav" aria-label="Main navigation">
          <button className={view === 'search' ? 'nav-link active' : 'nav-link'} onClick={() => void changeView('search')}>Find a bus</button>
          {authUser && <button className={view === 'bookings' ? 'nav-link active' : 'nav-link'} onClick={() => void changeView('bookings')}>My bookings</button>}
          {authUser && <button className={view === 'rewards' ? 'nav-link active' : 'nav-link'} onClick={() => void changeView('rewards')}>Rewards</button>}
          {authUser?.role === 'ADMIN' && <button className={view === 'admin' ? 'nav-link active' : 'nav-link'} onClick={() => void changeView('admin')}>Admin</button>}
        </nav>
        <div className="header-actions">
          <button className="icon-button" aria-label={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'} onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}><Icon name={theme === 'light' ? 'moon' : 'sun'} /></button>
          {authUser ? <><button className="profile-chip" onClick={() => void changeView('profile')}><span className="avatar">{authUser.name.slice(0, 1).toUpperCase()}</span><span className="profile-name">{authUser.name.split(' ')[0]}</span></button><button className="button button-quiet header-signout" onClick={logout}>Sign out</button></> : <button className="button button-primary" onClick={() => { setAuthMode('login'); setAuthOpen(true); }}>Sign in</button>}
        </div>
      </header>

      <main className="page-content">
        {(globalError || notice) && <div className={globalError ? 'alert alert-error' : 'alert alert-success'} role={globalError ? 'alert' : 'status'}>{globalError || notice}<button aria-label="Dismiss message" onClick={() => { setGlobalError(''); setNotice(''); }}><Icon name="close" /></button></div>}
        {view === 'search' && <>
          <section className="hero">
            <div className="hero-copy"><span className="eyebrow"><span className="eyebrow-line" />Travel a little better</span><h1>Your next journey<br /><em>starts here.</em></h1><p>Find a seat, settle in, and let the road take you somewhere good.</p><div className="hero-proof"><span className="proof-dot" />Live availability · Transparent fares · Easy booking</div></div>
            <div className="hero-art" aria-hidden="true"><div className="sun-orb" /><div className="road-line" /><div className="art-label">GOOD TRIPS<br />GOOD STORIES</div><div className="art-bus"><span /><span /><span /><b /></div><div className="art-pin pin-one">DEL</div><div className="art-pin pin-two">JAI</div></div>
          </section>
          <section className="search-panel card">
            <div className="panel-heading"><div><span className="section-kicker">PLAN YOUR TRIP</span><h2>Where to next?</h2></div><span className="step-pill"><span>01</span> Search routes</span></div>
            <form onSubmit={searchTrips} className="search-form">
              <label className="field"><span>Leaving from</span><select value={originId} onChange={(event) => setOriginId(event.target.value)} disabled={citiesLoading || cities.length === 0} required><option value="">{citiesLoading ? 'Loading cities…' : 'Choose a city'}</option>{cities.map((city) => <option key={city.id} value={city.id}>{city.name} · {city.code}</option>)}</select></label>
              <div className="route-connector"><span><Icon name="arrow" /></span></div>
              <label className="field"><span>Going to</span><select value={destinationId} onChange={(event) => setDestinationId(event.target.value)} disabled={citiesLoading || cities.length === 0} required><option value="">Choose a city</option>{cities.map((city) => <option key={city.id} value={city.id}>{city.name} · {city.code}</option>)}</select></label>
              <label className="field"><span>Journey date</span><input type="date" min={dateIST(new Date())} value={journeyDate} onChange={(event) => setJourneyDate(event.target.value)} required /></label>
              <button className="button button-primary search-button" type="submit" disabled={citiesLoading || !cities.length || searching}><Icon name="search" />{searching ? 'Finding buses…' : 'Search buses'}</button>
            </form>
            {!citiesLoading && cities.length === 0 && <p className="inline-note">No cities are configured yet. Add demo routes using the seed instructions in the project README.</p>}
          </section>
          <section className="results-section" aria-live="polite">
            <div className="results-heading"><div><span className="section-kicker">YOUR OPTIONS</span><h2>{searched ? 'Available journeys' : 'Ready when you are'}</h2></div>{searched && !searching && <span className="result-count">{trips.length} {trips.length === 1 ? 'journey' : 'journeys'}</span>}</div>
            {searching && <div className="loading-card card"><span className="spinner" /><span>Finding the best journeys for you…</span></div>}
            {!searching && searched && trips.length === 0 && !globalError && <div className="empty-state card"><span className="empty-icon"><Icon name="search" /></span><h3>No buses on this route yet</h3><p>Try another date or route. New journeys are added regularly.</p></div>}
            {!searched && <div className="feature-row"><div className="feature-card"><span>01</span><strong>Compare your ride</strong><p>Times, operators, and fares in one clear view.</p></div><div className="feature-card"><span>02</span><strong>Pick your seat</strong><p>See live availability before you book.</p></div><div className="feature-card"><span>03</span><strong>Travel with ease</strong><p>Your ticket and trip details stay in one place.</p></div></div>}
            {!searching && trips.map((trip) => <article className="trip-card card" key={trip.id}>
              <div className="trip-main"><div className="operator-mark"><Icon name="bus" /></div><div className="trip-info"><div className="trip-title"><h3>{trip.bus.name}</h3><span className="bus-type">{trip.bus.type}</span></div><p>{trip.bus.operator} <span className="bullet">·</span> {trip.distanceKm} km</p><div className="trip-times"><div><strong>{formatTime(trip.departureAt)}</strong><span>{trip.origin.name}</span></div><div className="duration"><span>{Math.floor(trip.durationMinutes / 60)}h {trip.durationMinutes % 60 ? (trip.durationMinutes % 60) + 'm' : ''}</span><i /></div><div><strong>{formatTime(trip.arrivalAt)}</strong><span>{trip.destination.name}</span></div></div></div></div>
              <div className="trip-price"><div><span>FARES FROM</span><strong>{money(trip.fare.minimumPaise)}</strong>{trip.fare.maximumPaise !== trip.fare.minimumPaise && trip.fare.maximumPaise !== null && <small>up to {money(trip.fare.maximumPaise)}</small>}</div><div className="availability"><span className="availability-dot" />{trip.availableSeats} seats left</div><button className="button button-primary" onClick={() => void showSeats(trip)}>Choose seats <Icon name="arrow" /></button></div>
            </article>)}
          </section>
        </>}

        {view === 'bookings' && <section className="content-page"><PageHeading kicker="YOUR TRAVEL" title="My bookings" subtitle="Every trip, ticket, and update in one place." /><div className="booking-list">{bookings.length === 0 ? <div className="empty-state card"><span className="empty-icon"><Icon name="ticket" /></span><h3>No bookings yet</h3><p>When you book a seat, your trip details will appear here.</p><button className="button button-primary" onClick={() => void changeView('search')}>Find a bus</button></div> : bookings.map((booking) => <article key={booking.id} className="booking-card card"><div className="booking-top"><div><span className={'status-tag status-' + booking.status.toLowerCase()}>{booking.status}</span><span className="booking-date">Booked {formatDate(booking.createdAt)}</span></div><span className="booking-reference">#{booking.id.slice(-8).toUpperCase()}</span></div><div className="booking-route"><div><strong>{booking.trip.route.origin.name}</strong><span>{formatTime(booking.trip.departureAt)}</span></div><div className="route-dash"><Icon name="arrow" /></div><div><strong>{booking.trip.route.destination.name}</strong><span>{booking.trip.bus.name}</span></div><div className="booking-total"><span>PAID</span><strong>{money(booking.totalPaise)}</strong></div></div><div className="booking-bottom"><span>{booking.seats.length ? 'Seat' + (booking.seats.length > 1 ? 's' : '') + ' ' + booking.seats.map((seat) => seat.number || seat.seatId).join(', ') : 'Payment attempt'} <span className="bullet">·</span> {booking.payment?.status || 'No payment'}</span>{booking.status === 'CONFIRMED' && new Date(booking.trip.departureAt).getTime() - Date.now() > 2 * 60 * 60 * 1000 && <button className="button button-quiet danger-text" onClick={() => void cancelBooking(booking)}>Cancel booking</button>}{booking.cancellation && <span className="refund-note">Refund {money(booking.cancellation.refundPaise)}</span>}</div></article>)}</div></section>}

        {view === 'rewards' && <section className="content-page"><PageHeading kicker="SMARTBUS REWARDS" title="The miles add up." subtitle="Complete journeys, earn distance, and unlock a free seat." />{loyalty ? <div className="reward-layout"><div className="reward-card card"><span className="reward-symbol">✳</span><span className="section-kicker">YOUR JOURNEY MILEAGE</span><strong className="mileage-number">{loyalty.travelledKm.toLocaleString('en-IN')}<small> km</small></strong><div className="progress-track"><span style={{ width: Math.min(100, (loyalty.travelledKm / loyalty.rewardThresholdKm) * 100) + '%' }} /></div><div className="progress-label"><span>0 km</span><span>{loyalty.rewardThresholdKm.toLocaleString('en-IN')} km</span></div><p>{loyalty.travelledKm >= loyalty.rewardThresholdKm ? 'You reached the milestone.' : (loyalty.rewardThresholdKm - loyalty.travelledKm).toLocaleString('en-IN') + ' km until your reward.'}</p></div><div className="reward-copy card"><span className="section-kicker">A LITTLE SOMETHING BACK</span><h3>One free seat at 10,000 km.</h3><p>{loyalty.rewardDescription} Completed bookings count toward your journey distance.</p>{loyalty.rewardRedeemedAt ? <div className="inline-note">Your milestone reward has been redeemed.</div> : loyalty.rewardAvailable ? <div className="inline-note success-note">Your reward is ready. Choose seats and apply it at checkout.</div> : <div className="inline-note">Keep traveling. Your progress updates when completed trips are recorded.</div>}<button className="button button-primary" onClick={() => void changeView('search')}>Find your next trip <Icon name="arrow" /></button></div></div> : <div className="loading-card card"><span className="spinner" />Loading your rewards…</div>}</section>}

        {view === 'profile' && <section className="content-page narrow-page"><PageHeading kicker="YOUR ACCOUNT" title="Profile settings" subtitle="Keep your contact details up to date." /><form className="card form-card" onSubmit={saveProfile}><label className="field"><span>Full name</span><input value={profileName} onChange={(event) => setProfileName(event.target.value)} minLength={2} maxLength={100} required /></label><label className="field"><span>Email address</span><input value={authUser?.email || ''} readOnly /></label><label className="field"><span>Phone number</span><input value={profilePhone} onChange={(event) => setProfilePhone(event.target.value)} maxLength={30} /></label><div className="form-footer"><span className="muted">Username: {authUser?.username}</span><button className="button button-primary" disabled={profileBusy}>{profileBusy ? 'Saving…' : 'Save changes'}</button></div></form></section>}

        {view === 'admin' && authUser?.role === 'ADMIN' && <AdminPanel />}

        <footer className="site-footer"><a className="brand footer-brand" href="#search" onClick={(event) => { event.preventDefault(); void changeView('search'); }}><span className="brand-mark"><Icon name="bus" /></span><span>smartbus<span className="brand-dot">.</span></span></a><span>Good journeys start with good plans.</span><span>Times shown in India Standard Time</span></footer>
      </main>

      {authOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAuthOpen(false); }}><section className="auth-modal card" role="dialog" aria-modal="true" aria-labelledby="auth-title"><button className="modal-close icon-button" onClick={() => setAuthOpen(false)} aria-label="Close"><Icon name="close" /></button><span className="section-kicker">WELCOME TO SMARTBUS</span><h2 id="auth-title">{authMode === 'login' ? 'Good to see you.' : 'Make travel yours.'}</h2><p>{authMode === 'login' ? 'Sign in to choose seats and manage your trips.' : 'Create an account to book and track your journeys.'}</p>{authError && <div className="alert alert-error compact" role="alert">{authError}</div>}<form onSubmit={submitAuth} className="auth-form">{authMode === 'register' && <><label className="field"><span>Your name</span><input name="name" minLength={2} maxLength={100} autoComplete="name" required /></label><label className="field"><span>Username</span><input name="username" minLength={3} maxLength={32} pattern="[A-Za-z0-9_.-]+" autoComplete="username" required /></label><label className="field"><span>Phone (optional)</span><input name="phone" maxLength={30} autoComplete="tel" /></label></>}<label className="field"><span>Email address</span><input type="email" name="email" maxLength={254} autoComplete="email" required /></label><label className="field"><span>Password</span><input type="password" name="password" minLength={authMode === 'register' ? 10 : 1} maxLength={128} autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} required /></label><button className="button button-primary full-button" disabled={authBusy}>{authBusy ? 'Please wait…' : authMode === 'login' ? 'Sign in' : 'Create account'}</button></form><p className="auth-switch">{authMode === 'login' ? 'New to SmartBus?' : 'Already have an account?'} <button onClick={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setAuthError(''); }}>{authMode === 'login' ? 'Create an account' : 'Sign in'}</button></p></section></div>}

      {seatTrip && <SeatModal trip={seatTrip} seats={seatMap} loading={seatLoading} selected={selectedSeats} onToggle={toggleSeat} onClose={() => { if (hold) void releaseHold(); setSeatTrip(null); setHold(null); setSelectedSeats([]); }} hold={hold} secondsLeft={secondsLeft} fare={selectedFare} busy={bookingBusy} onHold={createHold} onRelease={releaseHold} onBook={confirmBooking} paymentMode={paymentMode} setPaymentMode={setPaymentMode} rewardAvailable={Boolean(loyalty?.rewardAvailable)} applyReward={applyReward} setApplyReward={setApplyReward} error={globalError} />}
    </div>
  );
}

function PageHeading({ kicker, title, subtitle }: { kicker: string; title: string; subtitle: string }) {
  return <div className="page-heading"><span className="section-kicker">{kicker}</span><h1>{title}</h1><p>{subtitle}</p></div>;
}

function SeatModal({ trip, seats, loading, selected, onToggle, onClose, hold, secondsLeft, fare, busy, onHold, onRelease, onBook, paymentMode, setPaymentMode, rewardAvailable, applyReward, setApplyReward, error }: {
  trip: Trip; seats: Seat[]; loading: boolean; selected: string[]; onToggle: (seat: Seat) => void; onClose: () => void;
  hold: Hold | null; secondsLeft: number; fare: number; busy: boolean; onHold: () => void; onRelease: () => void; onBook: () => void;
  paymentMode: 'success' | 'failure'; setPaymentMode: (value: 'success' | 'failure') => void;
  rewardAvailable: boolean; applyReward: boolean; setApplyReward: (value: boolean) => void; error: string;
}) {
  const rewardDiscount = hold && applyReward ? Math.min(...hold.seats.map((seat) => seat.farePaise)) : 0;
  const totalAfterReward = Math.max(0, fare - rewardDiscount);
  const grouped = [seats.filter((seat) => seat.category !== 'PREMIUM'), seats.filter((seat) => seat.category === 'PREMIUM')].filter((group) => group.length > 0);
  const seatNumber = (id: string) => seats.find((seat) => seat.id === id)?.number || id;
  return <div className="modal-backdrop" role="presentation"><section className="seat-modal card" role="dialog" aria-modal="true" aria-labelledby="seat-title"><div className="seat-modal-header"><div><span className="section-kicker">SELECT YOUR SEAT</span><h2 id="seat-title">{trip.bus.name}</h2><p>{trip.origin.name} to {trip.destination.name} · {formatDate(trip.departureAt)}</p></div><button className="icon-button" aria-label="Close seat selection" onClick={onClose}><Icon name="close" /></button></div>{error && <div className="alert alert-error compact" role="alert">{error}</div>}<div className="seat-layout">{loading ? <div className="loading-card"><span className="spinner" />Loading the seat map…</div> : <><div className="seat-map-card"><div className="driver-label">FRONT OF BUS</div><div className="seat-legend"><span><i className="seat-swatch available-swatch" />Available</span><span><i className="seat-swatch selected-swatch" />Selected</span><span><i className="seat-swatch occupied-swatch" />Unavailable</span></div>{grouped.map((group, index) => <div key={index} className="seat-grid">{group.map((seat) => <button key={seat.id} disabled={!seat.available || Boolean(hold)} className={'seat-button ' + (seat.premium ? 'premium-seat ' : '') + (selected.includes(seat.id) ? 'selected-seat' : '') + (!seat.available ? 'occupied-seat' : '')} onClick={() => onToggle(seat)} aria-label={seat.number + ', ' + seat.category + ', ' + (seat.available ? money(seat.farePaise) : 'unavailable')} title={seat.category + (seat.premium ? ' premium' : '') + ' · ' + (seat.available ? money(seat.farePaise) : 'Unavailable')}><span>{seat.number}</span>{seat.premium && <b>✦</b>}</button>)}</div>)}</div><div className="checkout-panel"><span className="section-kicker">YOUR SELECTION</span>{hold ? <><div className="hold-timer"><span className="availability-dot" />Reserved for you <strong>{Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}</strong></div><div className="checkout-seat-list">{hold.seats.map((seat) => <div key={seat.seatId}><span>Seat {seatNumber(seat.seatId)}</span><strong>{money(seat.farePaise)}</strong></div>)}</div><div className="checkout-total"><span>Trip total</span><strong>{money(totalAfterReward)}</strong></div>{applyReward && <div className="checkout-seat-list"><div><span>10,000 km reward</span><strong>−{money(rewardDiscount)}</strong></div></div>}{rewardAvailable && <label className="reward-toggle"><input type="checkbox" checked={applyReward} onChange={(event) => setApplyReward(event.target.checked)} /><span><strong>Use my 10,000 km reward</strong><small>One free seat on this booking</small></span></label>}<label className="field payment-select"><span>Demo payment</span><select value={paymentMode} onChange={(event) => setPaymentMode(event.target.value as 'success' | 'failure')}><option value="success">Simulate successful payment</option><option value="failure">Simulate declined payment</option></select></label><p className="demo-payment-note">No real payment details are collected or charged.</p><button className="button button-primary full-button" disabled={busy || secondsLeft === 0} onClick={() => void onBook()}>{busy ? 'Processing…' : applyReward ? 'Redeem reward & book' : 'Confirm booking'}</button><button className="button button-quiet full-button" disabled={busy} onClick={() => void onRelease()}>Release seats</button></> : <>{selected.length ? <div className="checkout-seat-list">{selected.map((id) => { const seat = seats.find((item) => item.id === id)!; return <div key={id}><span>Seat {seat.number} · {seat.category.toLowerCase()}</span><strong>{money(seat.farePaise)}</strong></div>; })}</div> : <p className="selection-hint">Select up to six seats from the map. Each seat’s fare is shown in the tooltip.</p>}<div className="checkout-total"><span>{selected.length} {selected.length === 1 ? 'seat' : 'seats'}</span><strong>{money(fare)}</strong></div><button className="button button-primary full-button" disabled={busy || selected.length === 0} onClick={() => void onHold()}>{busy ? 'Reserving…' : 'Hold selected seats'}</button><p className="demo-payment-note">Seats are held for eight minutes while you check out.</p></>}</div></>}</div></section></div>;
}

const adminKinds: Array<{ id: AdminKind; label: string }> = [
  { id: 'cities', label: 'Cities' }, { id: 'routes', label: 'Routes' }, { id: 'buses', label: 'Buses & seats' },
  { id: 'trips', label: 'Trips' }, { id: 'pricing-rules', label: 'Pricing' }, { id: 'bookings', label: 'Bookings' },
];

const adminFields: Record<Exclude<AdminKind, 'bookings'>, string[]> = {
  cities: ['name', 'code'], routes: ['originId', 'destinationId', 'distanceKm', 'baseFarePaise'],
  buses: ['name', 'operator', 'type', 'seats'], trips: ['routeId', 'busId', 'departureAt', 'arrivalAt', 'fareMultiplier'],
  'pricing-rules': ['tripId', 'seatCategory', 'date', 'multiplier', 'version', 'active'],
};

function AdminPanel() {
  const [kind, setKind] = useState<AdminKind>('cities');
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [lookup, setLookup] = useState<{ cities: AdminRow[]; routes: AdminRow[]; buses: AdminRow[]; trips: AdminRow[] }>({ cities: [], routes: [], buses: [], trips: [] });
  const [overview, setOverview] = useState<Record<string, number> | null>(null);
  const [selected, setSelected] = useState<AdminRow | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fields = kind === 'bookings' ? [] : adminFields[kind];

  async function refresh(nextKind = kind) {
    setBusy(true); setError('');
    try {
      const path = nextKind === 'bookings' ? 'bookings' : nextKind;
      const data = await api<Record<string, any>>('/api/admin/' + path);
      const nextRows = data[nextKind === 'pricing-rules' ? 'pricingRules' : nextKind] || [];
      setRows(nextRows);
      setSelected((current) => current ? (nextRows.find((row: AdminRow) => row.id === current.id) || null) : null);
      const [cities, routes, buses, trips, stats] = await Promise.all([
        api<{ cities: AdminRow[] }>('/api/admin/cities'), api<{ routes: AdminRow[] }>('/api/admin/routes'),
        api<{ buses: AdminRow[] }>('/api/admin/buses'), api<{ trips: AdminRow[] }>('/api/admin/trips'),
        api<Record<string, number>>('/api/admin/overview'),
      ]);
      setLookup({ cities: cities.cities, routes: routes.routes, buses: buses.buses, trips: trips.trips }); setOverview(stats);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load administration data.'); }
    finally { setBusy(false); }
  }

  useEffect(() => { setSelected(null); setValues({}); void refresh(kind); }, [kind]);

  function startEdit(row: AdminRow) {
    setSelected(row);
    const source = kind === 'routes' ? { ...row, baseFarePaise: String(row.baseFarePaise), distanceKm: String(row.distanceKm) } : row;
    const next: Record<string, string> = {};
    fields.filter((field) => field !== 'seats').forEach((field) => {
      let value = source[field];
      if (field === 'originId' || field === 'destinationId') value = row[field];
      if (field === 'departureAt' || field === 'arrivalAt') value = value ? datetimeISTInput(value) : '';
      if (field === 'date') value = value ? dateIST(new Date(value)) : '';
      next[field] = value === null || value === undefined ? '' : String(value);
    });
    setValues(next);
  }

  function newItem() { setSelected(null); setValues({}); }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const payload: Record<string, any> = {};
      Object.entries(values).forEach(([key, value]) => {
        if (key === 'seats') payload.seats = value.split(',').map((number) => number.trim()).filter(Boolean).map((number) => ({ number, category: 'STANDARD', premium: false }));
        else if (['distanceKm', 'baseFarePaise', 'fareMultiplier', 'multiplier', 'version'].includes(key)) payload[key] = value === '' ? undefined : Number(value);
        else if (key === 'active') payload[key] = value === 'true';
        else if (key === 'departureAt' || key === 'arrivalAt') payload[key] = value ? new Date(value + ':00+05:30').toISOString() : '';
        else if (key === 'date') payload[key] = value ? new Date(value + 'T00:00:00+05:30').toISOString() : null;
        else if ((key === 'tripId' || key === 'seatCategory') && !value) payload[key] = null;
        else payload[key] = value;
      });
      const path = kind === 'bookings' ? '' : kind;
      await api('/api/admin/' + path + (selected ? '/' + selected.id : ''), { method: selected ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
      setSelected(null); setValues({}); await refresh(kind);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save the record.'); }
    finally { setBusy(false); }
  }

  async function remove(row: AdminRow) {
    if (!window.confirm('Delete this record? Records referenced by trips or bookings are protected by the database.')) return;
    setBusy(true); setError('');
    try { await api('/api/admin/' + kind + '/' + row.id, { method: 'DELETE' }); await refresh(kind); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not delete the record.'); }
    finally { setBusy(false); }
  }

  const rowLabel = (row: AdminRow) => {
    if (kind === 'cities') return row.name + ' · ' + row.code;
    if (kind === 'routes') return (row.origin?.name || row.originId) + ' → ' + (row.destination?.name || row.destinationId);
    if (kind === 'buses') return row.name + ' · ' + (row.seats?.length || 0) + ' seats';
    if (kind === 'trips') return row.bus?.name + ' · ' + (row.route?.origin?.name || '') + ' → ' + (row.route?.destination?.name || '') + ' · ' + formatDate(row.departureAt);
    if (kind === 'pricing-rules') return (row.seatCategory || 'All seats') + ' · ' + row.multiplier + '% multiplier';
    return row.id + ' · ' + row.status + ' · ' + money(row.totalPaise);
  };

  return <section className="content-page admin-page"><PageHeading kicker="SMARTBUS CONTROL ROOM" title="Operations dashboard" subtitle="Manage the network and keep every journey moving." />{error && <div className="alert alert-error compact" role="alert">{error}</div>}<div className="stats-grid">{overview && Object.entries(overview).slice(0, 6).map(([label, value]) => <div className="stat-card card" key={label}><span>{label.replace(/([A-Z])/g, ' $1')}</span><strong>{value}</strong></div>)}</div><div className="admin-layout"><aside className="admin-sidebar card"><span className="section-kicker">MANAGE</span>{adminKinds.map((item) => <button className={kind === item.id ? 'admin-tab selected' : 'admin-tab'} key={item.id} onClick={() => setKind(item.id)}>{item.label}<span>{item.id === 'pricing-rules' ? '↗' : '›'}</span></button>)}</aside><div className="admin-main card"><div className="admin-list"><div className="admin-list-header"><div><span className="section-kicker">{kind.replace('-', ' ')}</span><h2>{adminKinds.find((item) => item.id === kind)?.label}</h2></div><span className="result-count">{rows.length} records</span></div>{busy && !rows.length ? <div className="loading-card"><span className="spinner" />Loading records…</div> : rows.length === 0 ? <p className="muted empty-admin">Nothing here yet. Add your first record.</p> : <div className="admin-records">{rows.map((row) => <div key={row.id} className={'admin-record ' + (selected?.id === row.id ? 'record-selected' : '')}><button className="record-select" onClick={() => startEdit(row)}><strong>{rowLabel(row)}</strong><small>{row.id}</small></button>{kind === 'bookings' && row.status === 'CONFIRMED' && <button className="button button-quiet" onClick={async () => { try { await api('/api/admin/bookings/' + row.id + '/complete', { method: 'POST', body: '{}' }); await refresh(kind); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not complete journey.'); } }}>Mark complete</button>}{kind !== 'bookings' && <button className="icon-button remove-button" aria-label={'Delete ' + rowLabel(row)} onClick={() => void remove(row)}>×</button>}</div>)}</div>}</div>{kind !== 'bookings' && <form className="admin-form" onSubmit={save}><div className="admin-form-heading"><div><span className="section-kicker">{selected ? 'UPDATE RECORD' : 'ADD TO NETWORK'}</span><h3>{selected ? 'Edit ' + kind.replace('-', ' ') : 'New ' + kind.replace('-', ' ')}</h3></div>{selected && <button type="button" className="button button-quiet" onClick={newItem}>New</button>}</div>{fields.filter((field) => !selected || field !== 'seats').map((field) => <label className="field" key={field}><span>{fieldLabel(field)}</span>{renderAdminField(field, values[field] || '', (value) => setValues((current) => ({ ...current, [field]: value })), lookup)}</label>)}<button className="button button-primary full-button" disabled={busy}>{busy ? 'Saving…' : selected ? 'Save changes' : 'Create ' + kind.replace('-', ' ').replace(/s$/, '')}</button><p className="demo-payment-note">Changes are recorded in the admin audit log. Referenced records cannot be deleted.</p>{kind === 'buses' && selected && <BusSeatAdmin bus={selected} onChanged={() => void refresh(kind)} />}</form>}</div></div></section>;
}

function BusSeatAdmin({ bus, onChanged }: { bus: AdminRow; onChanged: () => void }) {
  const [number, setNumber] = useState('');
  const [category, setCategory] = useState('STANDARD');
  const [premium, setPremium] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, { number: string; category: string; premium: boolean }>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDrafts(Object.fromEntries((bus.seats || []).map((seat: AdminRow) => [seat.id, { number: seat.number, category: seat.category, premium: seat.premium }])));
  }, [bus]);

  async function addSeat() {
    if (!number.trim()) { setError('Enter a seat number.'); return; }
    setBusy(true); setError('');
    try {
      await api('/api/admin/buses/' + bus.id + '/seats', { method: 'POST', body: JSON.stringify({ number, category, premium }) });
      setNumber(''); setCategory('STANDARD'); setPremium(false); onChanged();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not add this seat.'); }
    finally { setBusy(false); }
  }

  async function saveSeat(seatId: string) {
    setBusy(true); setError('');
    try { await api('/api/admin/buses/' + bus.id + '/seats/' + seatId, { method: 'PATCH', body: JSON.stringify(drafts[seatId]) }); onChanged(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not update this seat.'); }
    finally { setBusy(false); }
  }

  async function deleteSeat(seatId: string) {
    if (!window.confirm('Remove this seat? Seats referenced by trip inventory or bookings are protected.')) return;
    setBusy(true); setError('');
    try { await api('/api/admin/buses/' + bus.id + '/seats/' + seatId, { method: 'DELETE' }); onChanged(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not remove this seat.'); }
    finally { setBusy(false); }
  }

  return <div className="seat-admin"><div className="admin-form-heading"><div><span className="section-kicker">CAPACITY</span><h3>Manage bus seats</h3></div><span className="result-count">{bus.seats?.length || 0}</span></div>{error && <div className="alert alert-error compact">{error}</div>}<div className="seat-add-form"><label className="field"><span>Seat number</span><input value={number} onChange={(event) => setNumber(event.target.value)} maxLength={8} /></label><label className="field"><span>Category</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option>STANDARD</option><option>WINDOW</option><option>PREMIUM</option></select></label><label className="seat-premium-check"><input type="checkbox" checked={premium} onChange={(event) => setPremium(event.target.checked)} />Premium seat</label><button type="button" className="button button-primary" disabled={busy} onClick={() => void addSeat()}>Add seat</button></div><div className="bus-seat-rows">{(bus.seats || []).map((seat: AdminRow) => <div className="bus-seat-row" key={seat.id}><input aria-label={'Seat number ' + seat.number} value={drafts[seat.id]?.number || ''} onChange={(event) => setDrafts((current) => ({ ...current, [seat.id]: { ...current[seat.id], number: event.target.value } }))} /><select aria-label={'Seat category ' + seat.number} value={drafts[seat.id]?.category || 'STANDARD'} onChange={(event) => setDrafts((current) => ({ ...current, [seat.id]: { ...current[seat.id], category: event.target.value } }))}><option>STANDARD</option><option>WINDOW</option><option>PREMIUM</option></select><label className="seat-premium-check"><input type="checkbox" checked={Boolean(drafts[seat.id]?.premium)} onChange={(event) => setDrafts((current) => ({ ...current, [seat.id]: { ...current[seat.id], premium: event.target.checked } }))} />Premium</label><button type="button" className="button button-quiet" disabled={busy} onClick={() => void saveSeat(seat.id)}>Save</button><button type="button" className="icon-button remove-button" aria-label={'Remove seat ' + seat.number} onClick={() => void deleteSeat(seat.id)}>×</button></div>)}</div><p className="demo-payment-note">New seats are added to future scheduled trips. Seats with history cannot be deleted.</p></div>;
}

function fieldLabel(field: string) {
  const labels: Record<string, string> = { originId: 'Origin city', destinationId: 'Destination city', baseFarePaise: 'Base fare (paise)', distanceKm: 'Distance (km)', routeId: 'Route', busId: 'Bus', departureAt: 'Departure time (IST)', arrivalAt: 'Arrival time (IST)', fareMultiplier: 'Trip multiplier (%)', seatCategory: 'Seat category', tripId: 'Specific trip (optional)', multiplier: 'Fare multiplier (%)', version: 'Rule version', active: 'Rule is active', seats: 'Seat numbers, comma-separated' };
  return labels[field] || field.replace(/([A-Z])/g, ' $1').replace(/^./, (char) => char.toUpperCase());
}

function renderAdminField(field: string, value: string, onChange: (value: string) => void, lookup: { cities: AdminRow[]; routes: AdminRow[]; buses: AdminRow[]; trips: AdminRow[] }) {
  if (field === 'seatCategory') return <select value={value || ''} onChange={(event) => onChange(event.target.value)}><option value="">Any seat</option><option value="STANDARD">Standard</option><option value="WINDOW">Window</option><option value="PREMIUM">Premium</option></select>;
  const choices = field === 'originId' || field === 'destinationId' ? lookup.cities.map((item) => ({ id: item.id, label: item.name + ' · ' + item.code }))
    : field === 'routeId' ? lookup.routes.map((item) => ({ id: item.id, label: item.origin.name + ' → ' + item.destination.name }))
      : field === 'busId' ? lookup.buses.map((item) => ({ id: item.id, label: item.name }))
        : field === 'tripId' ? [{ id: '', label: 'Any trip' }, ...lookup.trips.map((item) => ({ id: item.id, label: item.bus.name + ' · ' + formatDate(item.departureAt) }))] : null;
  if (choices) return <select value={value} onChange={(event) => onChange(event.target.value)} required={field !== 'tripId'}>{field !== 'tripId' && <option value="">Choose {fieldLabel(field).toLowerCase()}</option>}{choices.map((choice) => <option value={choice.id} key={choice.id || 'any'}>{choice.label}</option>)}</select>;
  const type = field === 'date' ? 'date' : field === 'departureAt' || field === 'arrivalAt' ? 'datetime-local' : field === 'active' ? 'select' : ['distanceKm', 'baseFarePaise', 'fareMultiplier', 'multiplier', 'version'].includes(field) ? 'number' : 'text';
  if (type === 'select') return <select value={value || 'true'} onChange={(event) => onChange(event.target.value)}><option value="true">Active</option><option value="false">Inactive</option></select>;
  return <input type={type} value={value} onChange={(event) => onChange(event.target.value)} min={type === 'number' ? '0' : undefined} step={type === 'number' ? '1' : undefined} required={field !== 'date' && field !== 'tripId' && field !== 'seatCategory'} placeholder={field === 'seats' ? '1A, 1B, 2A, 2B' : undefined} />;
}

export default App;

