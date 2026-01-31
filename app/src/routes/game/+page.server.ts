import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const year = url.searchParams.get('year');
	const awayTeam = url.searchParams.get('away');
	const homeTeam = url.searchParams.get('home');

	// TODO: Load season data and team rosters
	return {
		year: year || '1976',
		awayTeam,
		homeTeam
	};
};
