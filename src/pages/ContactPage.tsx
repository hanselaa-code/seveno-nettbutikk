import { Clock, Mail, Truck } from 'lucide-react';
import { ContactForm } from '../components/contact/ContactForm';

export function ContactPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-12 lg:px-8">
      <div className="max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-bronze">
          Kundeservice
        </p>
        <h1 className="mt-2 font-serif text-3xl font-semibold text-espresso sm:text-4xl">
          Kontakt oss
        </h1>
        <p className="mt-3 text-base leading-relaxed text-charcoal">
          Har du spørsmål om våre produkter, materialer, levering eller spesialtilpasninger? Send
          oss en henvendelse via skjemaet, så svarer vi deg så snart som mulig.
        </p>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <ContactForm />
        </div>

        <aside className="lg:col-span-4">
          <div className="rounded-xl border border-sand bg-linen p-6 shadow-nordic sm:p-8">
            <h2 className="font-serif text-2xl font-semibold text-espresso">Seveno Studio</h2>
            <p className="mt-2 text-sm leading-relaxed text-charcoal">
              Norsk kundeservice og rådgivning for hjem, livsstil og uterom.
            </p>

            <div className="mt-6 space-y-4 text-sm text-charcoal">
              <div className="flex items-start gap-3">
                <Mail className="mt-0.5 h-4 w-4 shrink-0 text-bronze" aria-hidden="true" />
                <div>
                  <p className="font-semibold text-espresso">E-post</p>
                  <p>kundeservice@seveno.no</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Clock className="mt-0.5 h-4 w-4 shrink-0 text-bronze" aria-hidden="true" />
                <div>
                  <p className="font-semibold text-espresso">Åpningstider</p>
                  <p>Mandag–fredag kl. 09:00–16:00</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Truck className="mt-0.5 h-4 w-4 shrink-0 text-bronze" aria-hidden="true" />
                <div>
                  <p className="font-semibold text-espresso">Frakt og levering</p>
                  <p>Gratis frakt over 1 500 kr (ellers 99 kr)</p>
                </div>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
