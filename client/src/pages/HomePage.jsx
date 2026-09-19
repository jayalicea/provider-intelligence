import { Link } from 'react-router-dom'
import StatBand, { StatBandCaption } from '../components/StatBand.jsx'

const SURFACES = [
  {
    to: '/providers',
    title: 'Provider Search',
    description: 'Find a provider by name, NPI number, or location across the public NPI Registry.',
  },
  {
    to: '/cohort',
    title: 'Cohort Explorer',
    description: 'Slice the national provider directory by specialty, geography, and MIPS participation.',
  },
  {
    to: '/upload-roster',
    title: 'Screen a Roster',
    description: 'Upload a list of providers and check them against exclusions and quality data in bulk.',
  },
  {
    to: '/my-providers',
    title: 'My Providers',
    description: 'Keep a saved shortlist of providers you follow and return to their profiles quickly.',
  },
  {
    to: '/compare',
    title: 'Compare',
    description: 'Put two or more providers side by side on MIPS scores and profile details.',
  },
  {
    to: '/benchmark',
    title: 'Benchmark',
    description: 'See where a provider stands against national and specialty-level MIPS averages.',
  },
  {
    to: '/coverage',
    title: 'Coverage',
    description: 'Which public government datasets are loaded, how fresh each one is, and what is coming.',
  },
  {
    to: '/watchlist',
    title: 'Watchlist',
    description: 'Flag providers for closer review and keep an eye on their standing over time.',
  },
]

export default function HomePage() {
  return (
    <section>
      <h1 className="page-title">ProviderLens</h1>
      <p className="page-lede muted">
        A front door to public government healthcare data: check provider
        identity and integrity, from the NPI Registry to exclusion lists, with
        MIPS quality scores in between. Everything here comes from public US
        government sources, with an as-of date on every value.
      </p>

      <StatBand />
      <StatBandCaption />

      <div className="link-card-grid">
        {SURFACES.map((surface) => (
          <Link key={surface.to} to={surface.to} className="card link-card">
            <span className="link-card-title">{surface.title}</span>
            <span className="muted">{surface.description}</span>
          </Link>
        ))}
      </div>
    </section>
  )
}
