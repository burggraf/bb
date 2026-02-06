import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	// We'll load most data client-side, but pass the seriesId
	return {
		seriesId: params.id
	};
};
