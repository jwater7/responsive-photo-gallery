// vim: tabstop=2 shiftwidth=2 expandtab
//

import { useEffect } from 'react';
import Link from 'next/link'
import { logout as apiLogout } from '../lib/api';
import { usePing } from '../data/use-ping';

export default function Logout() {

    const { mutate: pingMutate } = usePing();
    const logout = async () => {
        try {
            const good = await apiLogout()
            if (!good) {
                throw new Error("no logout data")
            }
            pingMutate(false)
        } catch (err) {
            //TODO
            console.log('Failed to logout');
        }
    }

    useEffect(() => {
        logout()
    }, []);


    return (
        <div>
            <p>You are now logged out</p>
            <Link href="/login">Click here to log back in again</Link>
        </div>
    );
}
