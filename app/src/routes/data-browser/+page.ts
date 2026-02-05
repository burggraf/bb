import type { PageLoad } from './$types';

export const load: PageLoad = ({ url }) => {
	const yearParam = url.searchParams.get('year');
	const initialYear = yearParam ? parseInt(yearParam) : null;

	return {
		initialYear
	};
};
